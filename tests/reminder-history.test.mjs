import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProposalStore } from '../src/proposals.ts';
import { createToolDispatcher, toolDefinitions } from '../src/mcp-tools.ts';

// Synthetic local records only. No credentials, network or real reminders.
function fixture(t, { tables = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-reminder-history-'));
  const path = join(directory, 'history.sqlite');
  let store;
  let db;
  t.after(() => {
    try { db?.close(); } finally {
      try { store?.close(); } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });
  store = new ProposalStore(path);
  db = new DatabaseSync(path);
  if (tables) {
    db.exec([
      'CREATE TABLE paypal_reminder_approvals (',
      'approval_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,',
      'payload_sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,',
      'expires_at TEXT NOT NULL, approved_via TEXT NOT NULL);',
      'CREATE TABLE paypal_reminder_attempts (',
      'attempt_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,',
      'approval_id TEXT NOT NULL UNIQUE, started_at TEXT NOT NULL,',
      'completed_at TEXT, state TEXT NOT NULL',
      "CHECK (state IN ('started', 'succeeded', 'unknown')));",
    ].join(' '));
  }
  const proposal = store.createReminder({
    requestId: 'synthetic-history-request',
    invoiceId: 'synthetic-history-invoice',
    note: 'Synthetic local reminder draft.',
  });
  function approve(proposalId = proposal.id) {
    db.prepare('INSERT INTO paypal_reminder_approvals VALUES (?, ?, ?, ?, ?, ?)')
      .run('synthetic-approval', proposalId, 'synthetic-digest',
        '2026-10-28T16:00:00Z', '2026-10-28T16:15:00Z', 'local-terminal');
  }
  function attempt({ state = 'succeeded',
    startedAt = '2026-10-28T16:01:00Z',
    completedAt = '2026-10-28T16:01:01Z',
    approvalId = 'synthetic-approval', proposalId = proposal.id } = {}) {
    db.prepare('INSERT INTO paypal_reminder_attempts VALUES (?, ?, ?, ?, ?, ?)')
      .run('synthetic-attempt', proposalId, approvalId, startedAt, completedAt, state);
  }
  return { store, db, proposal, approve, attempt };
}

function result(history) {
  assert.deepEqual(history.timeline.map(entry => entry.stage),
    ['proposal', 'approval', 'execution_attempt', 'result']);
  return history.timeline[3];
}

test('history registry declares a read-only tool accepting only proposalId', () => {
  const tool = toolDefinitions.find(item => item.name === 'get_reminder_history');
  assert.ok(tool);
  assert.deepEqual(tool.inputSchema.required, ['proposalId']);
  assert.deepEqual(Object.keys(tool.inputSchema.properties), ['proposalId']);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.annotations, {
    readOnlyHint: true, destructiveHint: false,
    idempotentHint: true, openWorldHint: false,
  });
});

test('unknown proposal preserves four missing stages without inventing success', t => {
  const { store } = fixture(t);
  const history = store.getReminderHistory('not-present');
  assert.equal(history.found, false);
  assert.ok(history.timeline.every(entry => !entry.recorded));
  assert.equal(result(history).status, 'not_recorded');
  assert.equal(result(history).confirmed, false);
  assert.equal(result(history).uncertain, true);
  assert.match(history.unknowns.join(' '), /does not prove/);
});

test('draft-only history returns the stored proposal and missing later stages', t => {
  const { store, proposal } = fixture(t);
  const history = store.getReminderHistory(proposal.id);
  assert.equal(history.found, true);
  assert.equal(history.timeline[0].data.proposal_id, proposal.id);
  assert.equal(history.timeline[0].data.note, proposal.note);
  assert.deepEqual(history.timeline.map(entry => entry.recorded),
    [true, false, false, false]);
  assert.equal(result(history).status, 'not_recorded');
});

test('approval is reported as history without implying execution', t => {
  const { store, proposal, approve } = fixture(t);
  approve();
  const history = store.getReminderHistory(proposal.id);
  assert.equal(history.timeline[1].data.approval_id, 'synthetic-approval');
  assert.equal(history.timeline[1].at, '2026-10-28T16:00:00Z');
  assert.equal(result(history).confirmed, false);
  assert.match(history.unknowns.join(' '), /does not establish current permission/);
});

test('successful local execution preserves workflow order and delivery limits', t => {
  const { store, proposal, approve, attempt } = fixture(t);
  approve();
  attempt();
  const history = store.getReminderHistory(proposal.id);
  const outcome = result(history);
  assert.ok(history.timeline.every(entry => entry.recorded));
  assert.equal(history.timeline[2].data.attempt_id, 'synthetic-attempt');
  assert.equal(outcome.status, 'succeeded');
  assert.equal(outcome.confirmed, true);
  assert.equal(outcome.uncertain, false);
  assert.equal(outcome.at, '2026-10-28T16:01:01Z');
  assert.match(outcome.meaning, /Recipient delivery remains unverified/);
  assert.match(history.unknowns.join(' '), /payment status/);
  assert.match(history.unknowns.join(' '), /local database snapshot/);
});

test('started attempt without completion is uncertain and requires reconciliation', t => {
  const { store, proposal, approve, attempt } = fixture(t);
  approve();
  attempt({ state: 'started', completedAt: null });
  const history = store.getReminderHistory(proposal.id);
  const outcome = result(history);
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.recordedState, 'started');
  assert.equal(outcome.at, null);
  assert.equal(outcome.confirmed, false);
  assert.equal(outcome.uncertain, true);
  assert.match(history.unknowns.join(' '), /do not retry without reconciliation/);
});

test('unknown attempt stays uncertain even with a completion timestamp', t => {
  const { store, proposal, approve, attempt } = fixture(t);
  approve();
  attempt({ state: 'unknown' });
  const outcome = result(store.getReminderHistory(proposal.id));
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.recordedState, 'unknown');
  assert.equal(outcome.confirmed, false);
  assert.equal(outcome.uncertain, true);
});

test('succeeded record without completion is not confirmed', t => {
  const { store, proposal, approve, attempt } = fixture(t);
  approve();
  attempt({ completedAt: null });
  const outcome = result(store.getReminderHistory(proposal.id));
  assert.equal(outcome.recordedState, 'succeeded');
  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.confirmed, false);
});

test('invalid or reversed execution timestamps cannot confirm success', t => {
  const { store, db, proposal, approve, attempt } = fixture(t);
  approve();
  attempt({ completedAt: 'invalid-time' });
  assert.equal(result(store.getReminderHistory(proposal.id)).confirmed, false);
  db.prepare('UPDATE paypal_reminder_attempts SET completed_at = ?')
    .run('2026-10-28T16:00:00Z');
  assert.equal(result(store.getReminderHistory(proposal.id)).status, 'unknown');
  db.prepare('UPDATE paypal_reminder_attempts SET started_at = ?')
    .run('invalid-time');
  assert.equal(result(store.getReminderHistory(proposal.id)).confirmed, false);
});

test('missing history tables are reported without creating them', t => {
  const { store, db, proposal } = fixture(t, { tables: false });
  const before = db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all();
  const history = store.getReminderHistory(proposal.id);
  assert.deepEqual(history.missingTables,
    ['paypal_reminder_approvals', 'paypal_reminder_attempts']);
  assert.equal(result(history).uncertain, true);
  assert.deepEqual(db.prepare('SELECT name, sql FROM sqlite_master ORDER BY name').all(), before);
});

test('mismatched approval prevents confirmation and exposes the limitation', t => {
  const { store, proposal, approve, attempt } = fixture(t);
  approve();
  attempt({ approvalId: 'unmatched-approval' });
  const history = store.getReminderHistory(proposal.id);
  assert.equal(result(history).status, 'unknown');
  assert.match(history.unknowns.join(' '), /cannot be matched/);
});

test('orphan records and an absent approval never establish success', t => {
  const { store, db, proposal, approve, attempt } = fixture(t);
  approve();
  attempt();
  db.prepare('DELETE FROM paypal_reminder_proposals WHERE proposal_id = ?')
    .run(proposal.id);
  let history = store.getReminderHistory(proposal.id);
  assert.equal(history.found, false);
  assert.equal(result(history).confirmed, false);
  assert.match(history.unknowns.join(' '), /without the corresponding proposal/);
  db.prepare('DELETE FROM paypal_reminder_approvals WHERE proposal_id = ?')
    .run(proposal.id);
  history = store.getReminderHistory(proposal.id);
  assert.equal(result(history).confirmed, false);
  assert.match(history.unknowns.join(' '), /cannot be matched/);
});

test('dispatcher rejects invalid IDs and extra arguments before reading history', async () => {
  let reads = 0;
  const dispatch = createToolDispatcher({
    proposals: { getReminderHistory: () => { reads++; } },
  });
  for (const args of [null, [], 'invalid', {}, { proposalId: '' },
    { proposalId: ' ' }, { proposalId: 42 }, { proposalId: 'x'.repeat(256) },
    { proposalId: 'synthetic', execute: true },
    { proposalId: 'synthetic', approvalId: 'invented' }]) {
    await assert.rejects(dispatch('get_reminder_history', args));
  }
  assert.equal(reads, 0);
});

test('history reads are repeatable without database writes or external operations', async t => {
  const { store, db, proposal, approve, attempt } = fixture(t);
  approve();
  attempt();
  const tables = ['paypal_reminder_proposals',
    'paypal_reminder_approvals', 'paypal_reminder_attempts'];
  const snapshot = () => tables.map(table =>
    db.prepare('SELECT * FROM ' + table + ' ORDER BY proposal_id').all());
  const before = snapshot();
  const beforeVersion = db.prepare('PRAGMA data_version').get().data_version;
  const forbidden = async () => { throw new Error('Unexpected external operation'); };
  const dispatch = createToolDispatcher({
    proposals: store, executor: { execute: forbidden },
    listDisputes: forbidden, listUnpaidInvoices: forbidden, sendReminder: forbidden,
  });
  const first = await dispatch('get_reminder_history', { proposalId: proposal.id });
  const second = await dispatch('get_reminder_history', { proposalId: proposal.id });
  assert.deepEqual(second, first);
  assert.deepEqual(first.effects,
    { persisted: false, approved: false, executed: false, apiCalled: false });
  assert.deepEqual(snapshot(), before);
  assert.equal(db.prepare('PRAGMA data_version').get().data_version, beforeVersion);
  assert.equal(result(first).status, 'succeeded');
});
