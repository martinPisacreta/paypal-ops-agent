import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxUnpaidInvoiceReader } from '../src/paypal-invoices.ts';

const reader = body => createSandboxUnpaidInvoiceReader({
  async request() { return { status: 200, body }; },
});

test('explicitly empty PayPal collections may omit items', async () => {
  const result = await reader({ total_items: 0 })(1);
  assert.deepEqual(result.items, []);
  assert.equal(result.scannedCount, 0);
  assert.equal(result.returnedCount, 0);
  assert.equal(result.pagination.hasMore, false);
});

test('missing or invalid items cannot conceal an incomplete response', async () => {
  for (const body of [
    {},
    { total_items: 1 },
    { total_items: '0' },
    { total_items: 0, items: null },
    { total_items: 0, items: {} },
    { total_items: 0, links: null },
  ]) {
    await assert.rejects(reader(body)(1), /Invalid PayPal sandbox invoices/);
  }
});

test('invoice reads request totals to identify omitted empty collections', async () => {
  let calls = 0;
  const read = createSandboxUnpaidInvoiceReader({
    async request(method, path, body, query) {
      calls++;
      assert.equal(method, 'GET');
      assert.equal(path, '/v2/invoicing/invoices');
      assert.equal(body, undefined);
      assert.deepEqual(query, { page: 1, page_size: 3, total_required: true });
      return { status: 200, body: { total_items: 0 } };
    },
  });
  const result = await read(3);
  assert.equal(calls, 1);
  assert.deepEqual(result.items, []);
});
