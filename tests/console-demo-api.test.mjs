import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startDemoConsole } from '../dist/console-demo-server.js';
import { ProposalStore } from '../dist/proposals.js';

test('local demo API persists retry-safe drafts and blocks execution', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'paypal-console-'));
  const databasePath = join(directory, 'demo.sqlite');
  let proposalStore;
  let server;
  t.after(async () => {
    try {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
          server.closeAllConnections();
        });
      }
    } finally {
      try {
        proposalStore?.close();
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  });
  proposalStore = new ProposalStore(databasePath);
  server = await startDemoConsole(0, { proposalStore });
  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const response = await fetch(`${base}/api/demo/queue`);
  assert.equal(response.status, 200);
  const queue = await response.json();
  assert.equal(queue.simulated, true);
  assert.equal(queue.items.length, 4);
  assert.ok(queue.items.every(item => item.simulated === true));
  assert.deepEqual(new Set(queue.items.map(item => item.type)), new Set(['dispute', 'invoice']));
  const deadlines = queue.items.map(item => Date.parse(item.deadline));
  assert.deepEqual(deadlines, [...deadlines].sort((a, b) => a - b));

  const filtered = await fetch(`${base}/api/demo/queue?type=invoice&deadline=overdue`);
  assert.equal(filtered.status, 200);
  const filteredQueue = await filtered.json();
  assert.equal(filteredQueue.items.length, 1);
  const invoice = filteredQueue.items[0];
  assert.equal(invoice.type, 'invoice');
  assert.ok(Date.parse(invoice.deadline) < Date.parse(queue.asOf));
  assert.equal((await fetch(`${base}/api/demo/queue?type=unknown`)).status, 400);

  const draftResponse = await post('/api/demo/proposals', { itemId: invoice.id });
  assert.equal(draftResponse.status, 200);
  const draft = await draftResponse.json();
  assert.equal(draft.simulated, true);
  assert.equal(draft.approvalRecorded, false);
  assert.equal(draft.executed, false);
  assert.equal(draft.proposal.invoiceId, invoice.id);
  assert.equal(draft.proposal.status, 'pending');
  assert.match(draft.proposal.note, /SIMULATED DEMO ONLY/);
  assert.ok(draft.proposal.note.includes(invoice.amount));

  const retryResponse = await post('/api/demo/proposals', { itemId: invoice.id });
  assert.equal(retryResponse.status, 200);
  assert.deepEqual(await retryResponse.json(), draft);

  const dispute = queue.items.find(item => item.type === 'dispute');
  assert.equal((await post('/api/demo/proposals', { itemId: dispute.id })).status, 400);
  assert.equal((await post('/api/demo/proposals', {
    itemId: invoice.id, approved: true,
  })).status, 400);
  assert.equal((await post('/api/demo/proposals', { itemId: 'UNKNOWN' })).status, 400);

  // Read through an independent connection to verify the committed draft.
  const persisted = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = persisted.prepare(
      'SELECT proposal_id, invoice_id, note, status FROM paypal_reminder_proposals',
    ).get();
    assert.equal(row.proposal_id, draft.proposal.id);
    assert.equal(row.invoice_id, invoice.id);
    assert.equal(row.note, draft.proposal.note);
    assert.equal(row.status, 'pending');
    assert.equal(persisted.prepare(
      'SELECT COUNT(*) AS count FROM paypal_reminder_proposals',
    ).get().count, 1);
    assert.equal(persisted.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'paypal_reminder_approvals'",
    ).get().count, 0);
  } finally {
    persisted.close();
  }

  const execution = await post('/api/demo/execute', { proposalId: draft.proposal.id });
  assert.equal(execution.status, 403);
  const blocked = await execution.json();
  assert.equal(blocked.approvalRecorded, false);
  assert.equal(blocked.executed, false);

  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Operations review queue/);
  const asset = await fetch(`${base}/vendor/ag-grid-community.min.js`);
  assert.equal(asset.status, 200);
  assert.ok((await asset.text()).length > 0);
});
