import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProposalStore } from '../src/proposals.ts';
import { ReminderExecutor } from '../src/reminder-execution.ts';
import { createToolDispatcher, toolDefinitions } from '../src/mcp-tools.ts';

// Local databases and simulated operations only; no PayPal requests.
test('registry exposes exactly the four intended tools', () => {
  assert.deepEqual(toolDefinitions.map(tool => tool.name).sort(), [
    'execute_invoice_reminder', 'list_disputes',
    'list_unpaid_invoices', 'propose_invoice_reminder',
  ]);
  for (const tool of toolDefinitions) {
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
});

test('read tools validate limits before invoking operations', async () => {
  const calls = [];
  const dispatch = createToolDispatcher({
    listDisputes: async limit => { calls.push(['disputes', limit]); return []; },
    listUnpaidInvoices: async limit => { calls.push(['invoices', limit]); return []; },
  });
  for (const name of ['list_disputes', 'list_unpaid_invoices']) {
    for (const args of [null, [], 'invalid', { limit: 0 }, { limit: 101 },
      { limit: 1.5 }, { limit: '25' }, { limit: NaN }, { bypass: true }]) {
      await assert.rejects(dispatch(name, args));
    }
  }
  assert.deepEqual(calls, []);
  await dispatch('list_disputes', {});
  await dispatch('list_unpaid_invoices', { limit: 100 });
  assert.deepEqual(calls, [['disputes', 25], ['invoices', 100]]);
  await assert.rejects(dispatch('approve_invoice_reminder', {}), /Unknown tool/);
});

test('draft retries remain durable and MCP cannot supply approval or bypass it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-mcp-tools-'));
  const databasePath = join(directory, 'operations.sqlite');
  let proposals;
  let executor;
  let database;
  let sends = 0;
  try {
    proposals = new ProposalStore(databasePath);
    executor = new ReminderExecutor(databasePath);
    database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE paypal_reminder_approvals (
      approval_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,
      payload_sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, approved_via TEXT NOT NULL
    )`);
    const operations = {
      proposals, executor,
      listDisputes: async () => [],
      listUnpaidInvoices: async () => [],
      sendReminder: async () => { sends++; },
    };
    let dispatch = createToolDispatcher(operations);
    const input = { requestId: 'fictional-request', invoiceId: 'fictional-invoice',
      note: 'Fictional reminder for local testing.' };

    for (const invalid of [
      { ...input, note: ' ' },
      { ...input, invoiceId: '' },
      { ...input, requestId: 'x'.repeat(256) },
      { ...input, approved: true },
    ]) await assert.rejects(dispatch('propose_invoice_reminder', invalid));
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS n FROM paypal_reminder_proposals'
    ).get().n, 0);

    const proposal = await dispatch('propose_invoice_reminder', input);
    assert.equal(proposal.status, 'pending');
    assert.deepEqual(await dispatch('propose_invoice_reminder', input), proposal);
    await assert.rejects(dispatch('propose_invoice_reminder', {
      ...input, note: 'Changed content under the same request key',
    }), /different proposal/);

    proposals.close();
    proposals = undefined;
    proposals = new ProposalStore(databasePath);
    dispatch = createToolDispatcher({ ...operations, proposals });
    assert.deepEqual(await dispatch('propose_invoice_reminder', input), proposal);

    for (const extra of [
      { approved: true }, { approvalId: 'invented' },
      { bypass: true }, { note: 'Replacement content' },
    ]) {
      await assert.rejects(dispatch('execute_invoice_reminder', {
        proposalId: proposal.id, ...extra,
      }), /Unexpected tool argument/);
    }
    await assert.rejects(dispatch('execute_invoice_reminder', {
      proposalId: proposal.id,
    }), /approved pending proposal/);
    assert.equal(sends, 0);
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS n FROM paypal_reminder_attempts'
    ).get().n, 0);
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS n FROM paypal_reminder_approvals'
    ).get().n, 0);
  } finally {
    database?.close();
    executor?.close();
    proposals?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
