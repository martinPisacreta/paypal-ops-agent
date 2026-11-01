import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { consoleSandboxPage } from '../dist/console-sandbox-page.js';

// Execute the actual page script with a minimal DOM and fixture-only transport.
const settle = () => new Promise(resolve => setImmediate(resolve));
function element() {
  return { children: [], textContent: '', value: '', disabled: false, handlers: {},
    append(child) { this.children.push(child); },
    replaceChildren(...children) { this.children = children; this.value = ''; },
    addEventListener(name, handler) { this.handlers[name] = handler; } };
}
function history(id, invoiceId, status = 'unknown') {
  return { proposalId: id, found: true, timeline: [
    { stage: 'proposal', recorded: true, at: '2026-10-29T09:00:00Z',
      data: { proposalId: id, invoiceId } },
    { stage: 'approval', recorded: true, at: '2026-10-29T09:01:00Z' },
    { stage: 'execution_attempt', recorded: true, data: { attemptId: 'fixture-attempt' } },
    { stage: 'result', recorded: true, status, confirmed: status === 'succeeded' },
  ], reconciliation: { available: true, resendAllowed: false, reviews: [
    { recordedAt: '2026-10-29T09:02:00Z', operatorReportedOutcome: 'reported_accepted',
      evidenceKind: 'reminder_record' },
  ] } };
}
async function fixture(historyReader = id => history(id, 'INV2-A')) {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const requests = [];
  let gridOptions;
  const window = { addEventListener(_name, handler) { this.ready = handler; }, agGrid: {} };
  const proposals = [
    { proposalId: 'proposal-a', invoiceId: 'INV2-A', createdAt: '2026-10-29T09:00:00Z' },
    { proposalId: 'proposal-b', invoiceId: 'INV2-B', createdAt: '2026-10-29T09:00:00Z' },
  ];
  const fetch = async (path, options) => {
    requests.push({ path, options });
    const url = new URL(path, 'http://127.0.0.1');
    let data;
    if (url.pathname.endsWith('/queue')) data = { snapshotId: 'fixture-snapshot',
      items: [{ id: 'INV2-A' }, { id: 'INV2-B' }], limitations: [], asOf: 'fixture-time' };
    else if (url.pathname.endsWith('/proposals')) data = { proposals: { items: proposals } };
    else if (url.pathname.endsWith('/priority')) data = { explanation: 'Fixture only' };
    else if (url.pathname.endsWith('/history'))
      data = { history: await historyReader(url.searchParams.get('proposalId')) };
    else throw new Error('Unexpected fixture request');
    return { ok: true, async json() { return { mode: 'sandbox', readOnly: true, ...data }; } };
  };
  const scripts = [...consoleSandboxPage.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length);
  runInNewContext(scripts.at(-1)[1], { window,
    document: { getElementById: get, createElement: element },
    Option: function(text, value) { return { textContent: text, value }; },
    agGrid: { createGrid(_target, options) { gridOptions = options;
      return { setGridOption() {} }; } }, fetch, URLSearchParams });
  window.ready();
  await settle();
  return { get, requests,
    select: id => gridOptions.onSelectionChanged({ api: {
      getSelectedRows: () => id ? [{ id }] : [] } }),
    async choose(id) { get('proposals').value = id; await get('proposals').handlers.change(); },
  };
}

test('selected invoice shows only its proposals and correlated uncertain history', async () => {
  const page = await fixture();
  await page.select('INV2-A');
  assert.deepEqual(page.get('proposals').children.map(item => item.value), ['', 'proposal-a']);
  await page.choose('proposal-a');
  assert.match(page.get('result').textContent, /uncertain.*Do not resend/);
  assert.equal(page.get('timeline').children.length, 4);
  assert.match(page.get('reviews').children[0].textContent, /reported_accepted/);
  assert.match(page.get('reconciliation').textContent, /never authorize another send/);
  await page.select('INV2-B');
  assert.deepEqual(page.get('proposals').children.map(item => item.value), ['', 'proposal-b']);
  assert.equal(page.get('timeline').children.length, 0);
  assert.equal(page.get('reviews').children.length, 0);
  for (const { path, options } of page.requests) {
    assert.ok(path.startsWith('/api/sandbox/'));
    assert.equal(options.method, undefined);
    assert.equal(options.credentials, 'omit');
  }
});

test('history for another invoice is rejected without displaying its result', async () => {
  const page = await fixture(id => history(id, 'INV2-B', 'succeeded'));
  await page.select('INV2-A');
  await page.choose('proposal-a');
  assert.match(page.get('result').textContent, /history unavailable/);
  assert.equal(page.get('timeline').children.length, 0);
});

test('late history cannot replace the newly selected invoice workflow', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const page = await fixture(() => pending);
  await page.select('INV2-A');
  const reading = page.choose('proposal-a');
  await page.select('INV2-B');
  release(history('proposal-a', 'INV2-A', 'succeeded'));
  await reading;
  assert.match(page.get('selected-invoice').textContent, /INV2-B/);
  assert.equal(page.get('timeline').children.length, 0);
  assert.doesNotMatch(page.get('result').textContent, /recorded success/);
});

test('recorded success retains the recipient delivery limitation', async () => {
  const page = await fixture(id => history(id, 'INV2-A', 'succeeded'));
  await page.select('INV2-A');
  await page.choose('proposal-a');
  assert.match(page.get('result').textContent, /recorded success.*delivery remains unverified/);
});
