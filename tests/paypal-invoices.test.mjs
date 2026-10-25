import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxUnpaidInvoiceReader } from '../src/paypal-invoices.ts';

test('invoice reads exclude paid, cancelled and unsent invoices', async () => {
  const calls = [];
  const statuses = ['SENT', 'UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'DRAFT', 'SCHEDULED', 'REFUNDED'];
  const reader = createSandboxUnpaidInvoiceReader({
    async request(...args) {
      calls.push(args);
      return { status: 200, body: {
        items: statuses.map((status, index) => ({ id: 'INV-' + index, status })),
      } };
    },
  });
  const result = await reader(10);
  assert.deepEqual(calls, [[
    'GET', '/v2/invoicing/invoices', undefined, { page: 1, page_size: 10 },
  ]]);
  assert.deepEqual(result.items.map(item => item.id), ['INV-0', 'INV-1', 'INV-2']);
  assert.equal(result.scannedCount, 8);
  assert.equal(result.returnedCount, 3);
});

test('an empty filtered page preserves the indication of further results', async () => {
  let calls = 0;
  const reader = createSandboxUnpaidInvoiceReader({
    async request() {
      calls++;
      return { status: 200, body: {
        items: [{ id: 'INV-PAID', status: 'PAID' }],
        links: [{ rel: 'next', href: 'https://example.invalid/next' }],
      } };
    },
  });
  const result = await reader(1);
  assert.deepEqual(result.items, []);
  assert.equal(result.scannedCount, 1);
  assert.deepEqual(result.pagination, {
    scope: 'single_page', filteredLocally: true, hasMore: true,
  });
  assert.equal(calls, 1);
});

test('invalid limits fail before invoking the invoice transport', async () => {
  let calls = 0;
  const reader = createSandboxUnpaidInvoiceReader({
    async request() { calls++; throw new Error('Unexpected request'); },
  });
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity, '10', null, undefined]) {
    await assert.rejects(reader(limit), /limit/);
  }
  assert.equal(calls, 0);
});

test('malformed invoice responses cannot appear as empty successful reads', async () => {
  for (const body of [
    null, [], {}, { items: null }, { items: [null] },
    { items: [{ id: '', status: 'SENT' }] },
    { items: [{ id: 'INV-A' }] },
    { items: [{ id: 'INV-A', status: 1 }] },
    { items: [{ id: 'INV-A', status: ' ' }] },
    { items: [{ id: 'INV-A', status: 'SENT' }, { id: 'INV-B', status: 'SENT' }] },
    { items: [], links: {} }, { items: [], links: [null] },
  ]) {
    const reader = createSandboxUnpaidInvoiceReader({
      async request() { return { status: 200, body }; },
    });
    await assert.rejects(reader(1), /Invalid PayPal sandbox invoices/);
  }
});

test('transport failure remains distinguishable from an empty invoice page', async () => {
  let calls = 0;
  const reader = createSandboxUnpaidInvoiceReader({
    async request() { calls++; throw new Error('Transport unavailable'); },
  });
  await assert.rejects(reader(10), /Transport unavailable/);
  assert.equal(calls, 1);
});
