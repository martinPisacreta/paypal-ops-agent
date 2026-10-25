import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxWebhookVerifier } from '../src/paypal-webhook.ts';

const configuration = {
  environment: 'sandbox', clientId: 'test-fixture-credential-005',
  clientSecret: 'test-fixture-credential-006', webhookId: 'fictional-webhook',
  databasePath: ':memory:',
};
const headers = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/fictional-cert',
  'paypal-transmission-id': 'fictional-transmission',
  'paypal-transmission-sig': 'fictional-signature',
  'paypal-transmission-time': '2026-10-25T11:00:00Z',
};
const event = { id: 'fictional-event', event_type: 'TEST.EVENT', resource: {} };

// All verification responses are simulated; no PayPal requests are made.
test('verification maps signature headers and configured webhook identity', async () => {
  const calls = [];
  const verify = createSandboxWebhookVerifier(configuration, {
    request: async (...args) => {
      calls.push(args);
      return { status: 200, body: { verification_status: 'SUCCESS' } };
    },
  });
  assert.equal(await verify(headers, event), true);
  assert.deepEqual(calls, [[
    'POST', '/v1/notifications/verify-webhook-signature', {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: configuration.webhookId, webhook_event: event,
    },
  ]]);
});

test('only an explicit successful verification response is accepted', async () => {
  for (const body of [null, [], {}, true, 'SUCCESS',
    { verification_status: 'FAILURE' }, { verification_status: 'success' }]) {
    const verify = createSandboxWebhookVerifier(configuration, {
      request: async () => ({ status: 200, body }),
    });
    assert.equal(await verify(headers, event), false);
  }
  const verify = createSandboxWebhookVerifier(configuration, {
    request: async () => ({ status: 202, body: { verification_status: 'SUCCESS' } }),
  });
  assert.equal(await verify(headers, event), false);
});

test('invalid configuration and missing headers prevent verification requests', async () => {
  let calls = 0;
  const http = { request: async () => { calls++; throw new Error('Unexpected request'); } };
  for (const webhookId of ['', ' ', ' invalid', 'invalid\n']) {
    assert.throws(() => createSandboxWebhookVerifier({ ...configuration, webhookId }, http));
  }
  assert.throws(() => createSandboxWebhookVerifier({
    ...configuration, environment: 'production',
  }, http));
  const verify = createSandboxWebhookVerifier(configuration, http);
  for (const name of Object.keys(headers)) {
    await assert.rejects(verify({ ...headers, [name]: undefined }, event));
  }
  assert.equal(calls, 0);
});

test('transport failure propagates without retrying verification', async () => {
  let calls = 0;
  const verify = createSandboxWebhookVerifier(configuration, {
    request: async () => { calls++; throw new Error('Simulated transport failure'); },
  });
  await assert.rejects(verify(headers, event), /Simulated transport failure/);
  assert.equal(calls, 1);
});
