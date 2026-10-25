import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxDisputeReader } from '../src/paypal-disputes.ts';

test('bounded dispute reads report pagination without following response URLs', async () => {
  const calls = [];
  const reader = createSandboxDisputeReader({
    async request(...args) {
      calls.push(args);
      return { status: 200, body: {
        items: [{ dispute_id: 'DIS-FICTIONAL' }],
        links: [{ rel: 'next', href: 'https://example.invalid/next' }],
      } };
    },
  });
  const result = await reader(100);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    'GET', '/v1/customer/disputes', undefined, { page_size: 50 },
  ]);
  assert.equal(result.returnedCount, 1);
  assert.equal(result.requestedLimit, 100);
  assert.equal(result.pagination.hasMore, true);
  assert.equal(result.pagination.scope, 'single_page');
});

test('invalid limits cannot invoke the transport', async () => {
  let calls = 0;
  const reader = createSandboxDisputeReader({
    async request() { calls++; throw new Error('Unexpected request'); },
  });
  for (const limit of [0, -1, 101, 1.5, NaN, Infinity, '10', undefined]) {
    await assert.rejects(reader(limit), /limit/);
  }
  assert.equal(calls, 0);
});

test('malformed or oversized responses cannot appear as successful reads', async () => {
  for (const body of [
    null, [], {}, { items: null }, { items: [null] },
    { items: [{ dispute_id: ' ' }] },
    { items: [{ dispute_id: 123 }] },
    { items: [{ dispute_id: 'A' }, { dispute_id: 'B' }] },
    { items: [], links: {} },
    { items: [], links: [null] },
  ]) {
    const reader = createSandboxDisputeReader({
      async request() { return { status: 200, body }; },
    });
    await assert.rejects(reader(1), /Invalid PayPal sandbox disputes/);
  }
});

test('empty results and transport failures remain distinguishable', async () => {
  const emptyReader = createSandboxDisputeReader({
    async request() { return { status: 200, body: { items: [] } }; },
  });
  const result = await emptyReader(10);
  assert.deepEqual(result.items, []);
  assert.equal(result.pagination.hasMore, false);
  let calls = 0;
  const failingReader = createSandboxDisputeReader({
    async request() { calls++; throw new Error('Transport unavailable'); },
  });
  await assert.rejects(failingReader(10), /Transport unavailable/);
  assert.equal(calls, 1);
});
