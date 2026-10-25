import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebhookInbox } from '../src/webhooks.ts';

// Run: node --experimental-strip-types --test tests/webhooks.test.mjs
// All signature responses are simulated; no PayPal requests are made.
test('webhook intake verifies before persistence and deduplicates durably', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-inbox-test-'));
  const databasePath = join(directory, 'inbox.sqlite');
  const connections = new Set();
  const openInbox = () => {
    const inbox = new WebhookInbox(databasePath);
    connections.add(inbox);
    return inbox;
  };
  const headers = {
    'paypal-auth-algo': 'SHA256withRSA',
    'paypal-cert-url': 'https://example.invalid/test-certificate',
    'paypal-transmission-id': 'test-transmission',
    'paypal-transmission-sig': 'simulated-signature',
    'paypal-transmission-time': '2026-10-25T10:30:00Z',
  };
  const body = id => JSON.stringify({
    id, event_type: 'INVOICING.INVOICE.CREATED',
    resource: { id: 'test-invoice' },
  });
  const hasStatus = expected => error => error.status === expected;
  let inspection;
  try {
    let inbox = openInbox();
    inspection = new DatabaseSync(databasePath);
    const count = () => Number(inspection.prepare(
      'SELECT COUNT(*) AS total FROM paypal_webhook_inbox'
    ).get().total);

    await assert.rejects(inbox.receive('{', headers, async () => true), hasStatus(400));
    await assert.rejects(inbox.receive('{}', headers, async () => true), hasStatus(400));
    await assert.rejects(inbox.receive('x'.repeat(1_048_577), headers, async () => true), hasStatus(413));
    for (const name of Object.keys(headers)) {
      const incomplete = { ...headers };
      delete incomplete[name];
      let called = false;
      await assert.rejects(inbox.receive(body('unsigned'), incomplete, async () => {
        called = true;
        return true;
      }), hasStatus(401));
      assert.equal(called, false);
    }
    assert.equal(count(), 0);

    await assert.rejects(inbox.receive(body('invalid-signature'), headers, async () => false), hasStatus(401));
    await assert.rejects(inbox.receive(body('verification-error'), headers, async () => {
      throw new Error('Simulated verification outage');
    }), /Simulated verification outage/);
    assert.equal(count(), 0);

    let releaseVerification;
    const verification = new Promise(resolve => { releaseVerification = resolve; });
    const pending = inbox.receive(body('first-event'), headers, () => verification);
    assert.equal(count(), 0, 'No event is stored while verification is pending');
    releaseVerification(true);
    assert.equal((await pending).status, 'queued');

    let verificationCalls = 0;
    const verify = async () => { verificationCalls++; return true; };
    assert.equal((await inbox.receive(body('first-event'), headers, verify)).status, 'duplicate');
    assert.equal(verificationCalls, 1);
    await assert.rejects(inbox.receive(body('first-event'), headers, async () => false), hasStatus(401));
    assert.equal(count(), 1);

    const other = openInbox();
    const delayedVerifier = async () => {
      await new Promise(resolve => setImmediate(resolve));
      return true;
    };
    const results = await Promise.all([
      inbox.receive(body('concurrent-event'), headers, delayedVerifier),
      other.receive(body('concurrent-event'), headers, delayedVerifier),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), ['duplicate', 'queued']);
    assert.equal(count(), 2);

    for (const connection of connections) connection.close();
    connections.clear();
    inspection.close();
    inspection = undefined;
    inbox = openInbox();
    inspection = new DatabaseSync(databasePath);
    assert.equal((await inbox.receive(body('first-event'), headers, verify)).status, 'duplicate');
    assert.equal(count(), 2);
    const stored = inspection.prepare(
      'SELECT payload_json, state FROM paypal_webhook_inbox WHERE event_id = ?'
    ).get('first-event');
    assert.equal(stored.payload_json, body('first-event'));
    assert.equal(stored.state, 'pending');
  } finally {
    for (const connection of connections) connection.close();
    inspection?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
