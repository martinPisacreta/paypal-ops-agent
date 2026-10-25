import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebhookInbox } from '../src/webhooks.ts';
import { createWebhookServer } from '../src/webhook-http.ts';

// Loopback only; every signature response is simulated.
test('HTTP webhook intake rejects invalid requests and persists verified events once', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-http-test-'));
  let inbox;
  let inspection;
  let server;
  try {
    const databasePath = join(directory, 'operations.sqlite');
    inbox = new WebhookInbox(databasePath);
    inspection = new DatabaseSync(databasePath);
    let verificationCalls = 0;
    server = createWebhookServer(inbox, async headers => {
      verificationCalls++;
      if (headers['paypal-transmission-sig'] === 'outage') {
        throw new Error('Private diagnostic must not appear in HTTP responses');
      }
      return headers['paypal-transmission-sig'] === 'simulated-valid';
    });
    assert.throws(() => createWebhookServer(inbox, undefined), /verifier is required/);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    const headers = {
      'content-type': 'application/json',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-cert-url': 'https://example.invalid/certificate',
      'paypal-transmission-id': 'fictional-transmission',
      'paypal-transmission-sig': 'simulated-valid',
      'paypal-transmission-time': '2026-10-25T10:37:00Z',
    };
    const body = JSON.stringify({
      id: 'fictional-http-event',
      event_type: 'INVOICING.INVOICE.CREATED',
      resource: { id: 'fictional-invoice' },
    });

    const send = (label, options = {}) => new Promise((resolve, reject) => {
      const payload = Buffer.from(options.body ?? body);
      const suppliedHeaders = options.headers ?? headers;
      // Raw header arrays need an explicit Host as well as body framing.
      // Preserve duplicate PayPal headers so the application can reject them.
      const framedHeaders = Array.isArray(suppliedHeaders)
        ? ['Host', `127.0.0.1:${port}`, ...suppliedHeaders,
          'Content-Length', String(payload.length)]
        : { ...suppliedHeaders, 'content-length': String(payload.length) };
      const client = request({
        hostname: '127.0.0.1', port,
        path: options.path ?? '/webhooks/paypal',
        method: options.method ?? 'POST',
        headers: framedHeaders,
        agent: false,
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('error', reject);
        response.on('aborted', () => reject(new Error(`${label}: response aborted`)));
        response.on('end', () => {
          const rawBody = Buffer.concat(chunks).toString('utf8');
          try {
            assert.ok(rawBody.length > 0,
              `${label}: HTTP ${response.statusCode} returned an empty body; headers=${JSON.stringify(response.headers)}`);
            assert.match(response.headers['content-type'] ?? '', /^application\/json(?:;|$)/i,
              `${label}: expected JSON; HTTP ${response.statusCode}; body=${JSON.stringify(rawBody.slice(0, 300))}`);
            let parsed;
            try { parsed = JSON.parse(rawBody); } catch {
              throw new Error(`${label}: HTTP ${response.statusCode} returned invalid JSON: ${JSON.stringify(rawBody.slice(0, 300))}`);
            }
            resolve({ status: response.statusCode, headers: response.headers, body: parsed });
          } catch (error) { reject(error); }
        });
      });
      client.setTimeout(5000, () => client.destroy(new Error(`${label}: request timed out`)));
      client.on('error', reject);
      client.end(payload);
    });
    const count = () => Number(inspection.prepare(
      'SELECT COUNT(*) AS total FROM paypal_webhook_inbox'
    ).get().total);

    assert.equal((await send('unknown route', { path: '/unknown' })).status, 404);
    const method = await send('unsupported method', { method: 'GET', body: '' });
    assert.equal(method.status, 405);
    assert.equal(method.headers.allow, 'POST');
    assert.equal((await send('unsupported media type', {
      headers: { ...headers, 'content-type': 'text/plain' },
    })).status, 415);
    assert.equal((await send('encoded body', {
      headers: { ...headers, 'content-encoding': 'gzip' },
    })).status, 415);
    assert.equal((await send('malformed JSON', { body: '{' })).status, 400);
    assert.equal((await send('invalid UTF-8', { body: Buffer.from([0xff]) })).status, 400);
    assert.equal((await send('oversized body', { body: 'x'.repeat(1_048_577) })).status, 413);

    const duplicateHeaders = Object.entries(headers).flat();
    duplicateHeaders.push('PayPal-Transmission-Sig', 'another-signature');
    const duplicateHeaderResponse = await send('duplicate signature header', {
      headers: duplicateHeaders,
    });
    assert.equal(duplicateHeaderResponse.status, 400);
    assert.deepEqual(duplicateHeaderResponse.body, { error: 'Duplicate PayPal header' });
    assert.equal(verificationCalls, 0);
    assert.equal(count(), 0);

    const missingHeaders = { ...headers };
    delete missingHeaders['paypal-transmission-sig'];
    assert.equal((await send('missing signature', { headers: missingHeaders })).status, 401);
    assert.equal(verificationCalls, 0);
    assert.equal(count(), 0);

    assert.equal((await send('invalid signature', {
      headers: { ...headers, 'paypal-transmission-sig': 'invalid' },
    })).status, 401);
    const outage = await send('verification outage', {
      headers: { ...headers, 'paypal-transmission-sig': 'outage' },
    });
    assert.equal(outage.status, 503);
    assert.deepEqual(outage.body, { error: 'Webhook processing unavailable' });
    assert.equal(count(), 0);

    const accepted = await send('verified event');
    assert.equal(accepted.status, 200);
    assert.equal(accepted.headers['cache-control'], 'no-store');
    assert.equal(accepted.headers['x-content-type-options'], 'nosniff');
    assert.deepEqual(accepted.body, { status: 'queued', eventId: 'fictional-http-event' });
    assert.equal(count(), 1);
    const duplicate = await send('verified redelivery');
    assert.equal(duplicate.status, 200);
    assert.deepEqual(duplicate.body, { status: 'duplicate', eventId: 'fictional-http-event' });
    assert.equal(count(), 1);
    assert.equal(verificationCalls, 4);

    assert.equal((await send('invalid signature on stored event', {
      headers: { ...headers, 'paypal-transmission-sig': 'invalid' },
    })).status, 401);
    assert.equal(verificationCalls, 5);
    assert.equal(count(), 1);
    assert.equal(inspection.prepare(
      'SELECT state FROM paypal_webhook_inbox WHERE event_id = ?'
    ).get('fictional-http-event').state, 'pending');
  } finally {
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    }
    inspection?.close();
    inbox?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
