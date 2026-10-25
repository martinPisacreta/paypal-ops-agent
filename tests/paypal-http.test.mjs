import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxPayPalHttp } from '../src/paypal-http.ts';

const configuration = {
  environment: 'sandbox', clientId: 'test-fixture-credential-005',
  clientSecret: 'test-fixture-credential-006', webhookId: 'fictional-webhook',
  databasePath: ':memory:',
};
const tokenResponse = () => Response.json({
  access_token: 'test-fixture-credential-003', token_type: 'Bearer', expires_in: 3600,
});

test('concurrent requests share authentication and stay on sandbox', async () => {
  const calls = [];
  const http = new SandboxPayPalHttp(configuration, async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, 'https://api-m.sandbox.paypal.com');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return url.endsWith('/v1/oauth2/token')
      ? tokenResponse() : Response.json({ items: [] });
  });
  const results = await Promise.all([
    http.request('GET', '/v1/customer/disputes'),
    http.request('GET', '/v2/invoicing/invoices'),
  ]);
  assert.deepEqual(results.map(result => result.body), [{ items: [] }, { items: [] }]);
  assert.equal(calls.filter(call => call.url.endsWith('/v1/oauth2/token')).length, 1);
  await http.request('POST', '/v2/invoicing/invoices/INV-TEST/remind', { note: 'Test only' });
  assert.equal(calls.length, 4);
  const reminder = calls.at(-1);
  assert.equal(reminder.options.headers.Authorization, 'Bearer test-fixture-credential-003');
  assert.deepEqual(JSON.parse(reminder.options.body), { note: 'Test only' });
});

test('ambiguous outbound failure is attempted once and hides underlying errors', async () => {
  let operations = 0;
  const http = new SandboxPayPalHttp(configuration, async url => {
    if (url.endsWith('/v1/oauth2/token')) return tokenResponse();
    operations++;
    throw new Error('test-fixture-credential-006 test-fixture-credential-003 upstream details');
  });
  await assert.rejects(
    http.request('POST', '/v2/invoicing/invoices/INV-TEST/remind', { note: 'Test only' }),
    error => {
      assert.match(error.message, /outcome may be unknown/);
      assert.doesNotMatch(error.message, /test-fixture-credential-|upstream details/);
      return true;
    },
  );
  assert.equal(operations, 1);
});

test('invalid request paths and methods fail before authentication', async () => {
  let calls = 0;
  const http = new SandboxPayPalHttp(configuration, async () => {
    calls++;
    throw new Error('Must not fetch');
  });
  for (const path of [
    'https://api-m.paypal.com/v1/customer/disputes',
    '//example.com/v1/customer/disputes',
    '/v1/customer/../oauth2/token',
    '/v1/customer/%2e%2e/oauth2/token',
    '/v1/customer/disputes?redirect=example',
    '/v1/oauth2/token',
  ]) await assert.rejects(http.request('GET', path));
  await assert.rejects(http.request('DELETE', '/v1/customer/disputes'));
  await assert.rejects(http.request('GET', '/v1/customer/disputes', {}));
  assert.equal(calls, 0);
});

test('invalid OAuth response prevents API invocation', async () => {
  let calls = 0;
  const http = new SandboxPayPalHttp(configuration, async () => {
    calls++;
    return Response.json({ access_token: '', token_type: 'Bearer', expires_in: 3600 });
  });
  await assert.rejects(http.request('GET', '/v1/customer/disputes'), /authentication response/);
  assert.equal(calls, 1);
});

test('HTTP rejection is not retried and a successful empty response is accepted', async () => {
  for (const status of [204, 401, 429, 500]) {
    let operations = 0;
    const http = new SandboxPayPalHttp(configuration, async url => {
      if (url.endsWith('/v1/oauth2/token')) return tokenResponse();
      operations++;
      return new Response(null, { status });
    });
    const request = http.request('POST', '/v2/invoicing/invoices/INV-TEST/remind', { note: 'Test only' });
    if (status === 204) assert.deepEqual(await request, { status: 204, body: null });
    else await assert.rejects(request, /outcome may be unknown/);
    assert.equal(operations, 1);
  }
});
