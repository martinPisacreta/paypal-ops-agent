import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfiguration } from '../src/config.ts';

const fixture = {
  PAYPAL_ENVIRONMENT: 'sandbox',
  PAYPAL_CLIENT_ID: 'synthetic-client-id',
  PAYPAL_CLIENT_SECRET: 'synthetic-client-secret',
  PAYPAL_DATABASE_PATH: './data/synthetic-configuration.sqlite',
};

test('MCP may omit a webhook ID while webhook configuration remains strict', () => {
  for (const environment of [fixture, { ...fixture, PAYPAL_WEBHOOK_ID: '' }]) {
    assert.equal(loadConfiguration(environment, { requireWebhookId: false }).webhookId, '');
    assert.throws(() => loadConfiguration(environment), /PAYPAL_WEBHOOK_ID/);
  }
});

test('optional webhook configuration still rejects malformed IDs and production', () => {
  for (const webhookId of [' ', ' synthetic-webhook', 'synthetic\nwebhook']) {
    assert.throws(() => loadConfiguration(
      { ...fixture, PAYPAL_WEBHOOK_ID: webhookId },
      { requireWebhookId: false },
    ), /PAYPAL_WEBHOOK_ID/);
  }
  assert.throws(() => loadConfiguration(
    { ...fixture, PAYPAL_ENVIRONMENT: 'production' },
    { requireWebhookId: false },
  ), /sandbox/);
});
