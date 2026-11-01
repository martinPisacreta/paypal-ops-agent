import test from 'node:test';
import assert from 'node:assert/strict';
import { sandboxInvoiceQueue } from '../dist/console-sandbox-invoices.js';
import { sandboxInvoicePriority } from '../dist/console-sandbox-priority.js';
import { startDemoConsole } from '../dist/console-demo-server.js';

const asOf = '2026-10-28T18:00:00.000Z';
const proposalId = '11111111-1111-4111-8111-111111111111';
const invoice = () => ({
  id: 'INV2-TEST-001', status: 'UNPAID',
  due_amount: { value: '10.00', currency_code: 'USD' },
  detail: { payment_term: { due_date: '2026-10-27' } },
});
const raw = () => ({ items: [invoice()], pagination: { hasMore: true } });

async function serverFixture(t) {
  let reads = 0;
  const server = await startDemoConsole(0, { sandboxReads: {
    readInvoices: async limit => {
      assert.equal(limit, 100); reads++; return raw();
    },
    listProposals: () => ({ items: [{ proposalId }], hasMore: false }),
    getHistory: id => ({ proposalId: id, found: true, timeline: [] }),
  } });
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    assert.equal(server.listening, false);
  });
  assert.equal(server.address().address, '127.0.0.1');
  const base = 'http://127.0.0.1:' + server.address().port;
  return { get: path => fetch(base + path), base, reads: () => reads };
}

test('invoice projection omits customer data, credentials and arbitrary text', () => {
  const item = invoice();
  item.primary_recipients = [{ email_address: 'private@example.test' }];
  item.detail.note = 'secret-token';
  item.links = [{ href: 'https://private.example.test' }];
  const queue = sandboxInvoiceQueue({ items: [item] }, asOf);
  const text = JSON.stringify(queue);
  for (const forbidden of ['private@example.test', 'secret-token', 'private.example.test']) {
    assert.equal(text.includes(forbidden), false);
  }
  assert.equal(queue.items[0].previousReminders, null);
  assert.equal(queue.items[0].openDispute, null);
  assert.equal(queue.items[0].deadline, '2026-10-27T00:00:00.000Z');
});

test('invalid dates and unavailable outstanding amounts remain unknown', () => {
  const item = invoice();
  item.detail.payment_term.due_date = '2026-02-30';
  delete item.due_amount;
  item.amount = { value: '100.00', currency_code: 'USD' };
  const queue = sandboxInvoiceQueue({ items: [item] }, asOf);
  assert.equal(queue.items[0].deadline, null);
  assert.equal(queue.items[0].amount, null);
});

test('duplicate IDs and non-invoice identifiers reject the snapshot', () => {
  assert.throws(() => sandboxInvoiceQueue({ items: [invoice(), invoice()] }, asOf));
  assert.throws(() => sandboxInvoiceQueue({
    items: [{ ...invoice(), id: 'private@example.test' }],
  }, asOf));
});

test('priority comparison labels assumptions and requires manual review', () => {
  const queue = sandboxInvoiceQueue(raw(), asOf);
  const result = sandboxInvoicePriority(queue.items, queue.items[0].id, asOf);
  assert.equal(result.available, true);
  assert.equal(result.manualReviewRequired, true);
  assert.match(result.limitations.join(' '), /hypothetical inputs, not verified facts/);
  assert.deepEqual(result.effects, { persisted: false, approved: false, executed: false });
});

test('missing amount prevents priority calculation', () => {
  const queue = sandboxInvoiceQueue({ items: [{ ...invoice(), due_amount: null }] }, asOf);
  const result = sandboxInvoicePriority(queue.items, queue.items[0].id, asOf);
  assert.equal(result.available, false);
  assert.equal(result.explanation, null);
});

test('priority reads reuse the displayed snapshot and reject stale selection', async t => {
  const fixture = await serverFixture(t);
  const queue = await (await fixture.get('/api/sandbox/queue')).json();
  const path = '/api/sandbox/priority?' + new URLSearchParams({
    invoiceId: queue.items[0].id, snapshotId: queue.snapshotId,
  });
  const response = await fixture.get(path);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).asOf, queue.asOf);
  assert.equal(fixture.reads(), 1);
  await fixture.get('/api/sandbox/queue');
  assert.equal((await fixture.get(path)).status, 409);
});

test('proposal and history routes expose read-only envelopes', async t => {
  const fixture = await serverFixture(t);
  for (const path of ['/api/sandbox/proposals',
    '/api/sandbox/history?proposalId=' + proposalId]) {
    const response = await fixture.get(path);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, 'sandbox');
    assert.equal(body.readOnly, true);
  }
  assert.equal(fixture.reads(), 0);
});

test('sandbox routes reject writes and foreign origins before reading', async t => {
  const fixture = await serverFixture(t);
  for (const route of ['queue', 'priority', 'proposals', 'history', 'approve', 'execute']) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal((await fetch(fixture.base + '/api/sandbox/' + route, { method })).status, 405);
    }
  }
  assert.equal((await fetch(fixture.base + '/api/sandbox/queue', {
    headers: { Origin: 'https://untrusted.example' },
  })).status, 403);
  assert.equal(fixture.reads(), 0);
});
