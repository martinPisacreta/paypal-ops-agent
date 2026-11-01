import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ReminderReconciliationStore } from '../src/reminder-reconciliation.ts';

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-reconciliation-'));
  const path = join(directory, 'synthetic.sqlite');
  const database = new DatabaseSync(path);
  const stores = [];
  const open = () => {
    const store = new ReminderReconciliationStore(path);
    stores.push(store);
    return store;
  };
  try {
    database.exec(`
      CREATE TABLE paypal_reminder_proposals (proposal_id TEXT PRIMARY KEY, invoice_id TEXT);
      CREATE TABLE paypal_reminder_approvals (approval_id TEXT PRIMARY KEY, proposal_id TEXT);
      CREATE TABLE paypal_reminder_attempts
        (attempt_id TEXT PRIMARY KEY, proposal_id TEXT UNIQUE, approval_id TEXT UNIQUE, state TEXT);
      INSERT INTO paypal_reminder_proposals VALUES ('proposal-1', 'synthetic-invoice-1');
      INSERT INTO paypal_reminder_approvals VALUES ('approval-1', 'proposal-1');
      INSERT INTO paypal_reminder_attempts VALUES ('attempt-1', 'proposal-1', 'approval-1', 'unknown');
    `);
    const review = { proposalId: 'proposal-1', approvalId: 'approval-1',
      attemptId: 'attempt-1', invoiceId: 'synthetic-invoice-1',
      outcome: 'unresolved', evidenceKind: 'invoice_read',
      evidenceReference: 'synthetic-local-evidence.json' };
    run({ database, open, review });
  } finally {
    for (const store of stores) store.close();
    database.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('reviews persist across connections and preserve the original uncertain attempt', () => {
  fixture(({ database, open, review }) => {
    const before = database.prepare('SELECT * FROM paypal_reminder_attempts').all();
    const first = open().recordReview(review);
    const second = open().recordReview({ ...review, outcome: 'reported_accepted',
      evidenceKind: 'reminder_record', evidenceReference: 'synthetic-reminder-record.json' });
    assert.notEqual(first.reviewId, second.reviewId);
    for (const result of [first, second]) {
      assert.equal(result.resendAllowed, false);
      assert.equal(result.independentlyVerified, false);
      assert.equal(result.recipientDeliveryVerified, false);
      assert.equal(result.recordedExecutionState, 'unknown');
    }
    assert.deepEqual(database.prepare('SELECT * FROM paypal_reminder_attempts').all(), before);
    const rows = database.prepare('SELECT * FROM paypal_reminder_reconciliation_reviews').all();
    assert.equal(rows.length, 2);
    assert.equal(rows[0].outcome, 'unresolved');
    assert.equal(rows[1].outcome, 'reported_accepted');
  });
});

test('mismatched operation identifiers cannot attach reconciliation evidence', () => {
  fixture(({ database, open, review }) => {
    const store = open();
    for (const field of ['proposalId', 'approvalId', 'attemptId', 'invoiceId']) {
      assert.throws(() => store.recordReview({ ...review, [field]: 'another-operation' }),
        /match one recorded operation/);
    }
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS n FROM paypal_reminder_reconciliation_reviews').get().n, 0);
  });
});

test('invoice reads and creation webhooks cannot establish reminder acceptance or rejection', () => {
  fixture(({ database, open, review }) => {
    const store = open();
    for (const evidenceKind of ['invoice_read', 'creation_webhook']) {
      for (const outcome of ['reported_accepted', 'reported_not_accepted']) {
        assert.throws(() => store.recordReview({ ...review, evidenceKind, outcome }),
          /cannot resolve reminder outcomes/);
      }
    }
    assert.equal(database.prepare(
      'SELECT COUNT(*) AS n FROM paypal_reminder_reconciliation_reviews').get().n, 0);
  });
});
