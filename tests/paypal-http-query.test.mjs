import test from 'node:test';
import assert from 'node:assert/strict';
import { SandboxPayPalHttp } from '../src/paypal-http.ts';

const configuration = {
  environment: 'sandbox', clientId: 'test-fixture-credential-005',
  clientSecret: 'test-fixture-credential-006', webhookId: 'fictional-webhook',
  databasePath: ':memory:',
};

test('structured query values preserve sandbox origin and API path', async () => {
  const calls = [];
  const http = new SandboxPayPalHttp(configuration, async (url, options) => {
    calls.push({ url, options });
    return url.endsWith('/v1/oauth2/token')
      ? Response.json({ access_token: 'test-fixture-credential-003', token_type: 'Bearer', expires_in: 3600 })
      : Response.json({ items: [] });
  });
  const query = {
    page: 2, page_size: 10, total_required: true,
    cursor: 'a&b=/#? https://example.com café',
  };
  await http.request('GET', '/v1/customer/disputes', undefined, query);
  assert.equal(calls.length, 2);
  const request = calls.at(-1);
  const url = new URL(request.url);
  assert.equal(url.origin, 'https://api-m.sandbox.paypal.com');
  assert.equal(url.pathname, '/v1/customer/disputes');
  assert.equal(url.hash, '');
  assert.deepEqual([...url.searchParams],
    Object.entries(query).map(([key, value]) => [key, String(value)]));
  assert.equal(request.options.headers.Authorization, 'Bearer test-fixture-credential-003');
  assert.equal(request.options.redirect, 'error');
});

test('invalid structured queries fail without requesting authentication', async () => {
  let calls = 0;
  const http = new SandboxPayPalHttp(configuration, async () => {
    calls++;
    throw new Error('Must not fetch');
  });
  const invalidQueries = [
    null, [], 'page=2',
    { 'page&redirect': 1 }, { '': 1 },
    { page: NaN }, { page: Infinity },
    { page: {} }, { page: undefined }, { page: null },
    { cursor: 'line\nbreak' }, { cursor: 'line\rbreak' },
    { cursor: 'null\0byte' }, { cursor: 'x'.repeat(2049) },
    Object.fromEntries(Array.from({ length: 21 }, (_, i) => ['key_' + i, i])),
  ];
  for (const query of invalidQueries) {
    await assert.rejects(
      http.request('GET', '/v1/customer/disputes', undefined, query),
      /Invalid PayPal sandbox query/,
    );
  }
  assert.equal(calls, 0);
});

test('empty structured queries preserve the original request URL', async () => {
  const urls = [];
  const http = new SandboxPayPalHttp(configuration, async url => {
    urls.push(url);
    return url.endsWith('/v1/oauth2/token')
      ? Response.json({ access_token: 'test-fixture-credential-003', token_type: 'Bearer', expires_in: 3600 })
      : Response.json({ items: [] });
  });
  await http.request('GET', '/v2/invoicing/invoices', undefined, {});
  assert.equal(urls.at(-1), 'https://api-m.sandbox.paypal.com/v2/invoicing/invoices');
});
