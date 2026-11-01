import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProposalStore } from '../src/proposals.ts';
import { ReminderExecutor } from '../src/reminder-execution.ts';
import { ReminderReconciliationStore } from '../src/reminder-reconciliation.ts';
import { openSandboxConsoleHistory } from '../dist/console-sandbox-store.js';

// Temporary SQLite and a fake sender only; no PayPal or network calls.
test('reconciled uncertainty persists in console history without permitting another send', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-review-history-'));
  const path = join(directory, 'synthetic.sqlite');
  const connections = new Set();
  const track = value => { connections.add(value); return value; };
  const close = value => { value.close(); connections.delete(value); };
  try {
    const proposals = track(new ProposalStore(path));
    const proposal = proposals.createReminder({
      requestId: 'synthetic-request', invoiceId: 'INV2-SYNTHETIC-1',
      note: 'PRIVATE_SYNTHETIC_MESSAGE',
    });
    const database = track(new DatabaseSync(path));
    database.exec(`CREATE TABLE paypal_reminder_approvals (
      approval_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,
      payload_sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, approved_via TEXT NOT NULL
    )`);
    const approvalId = randomUUID();
    const reviewed = { proposalId: proposal.id, requestId: proposal.requestId,
      invoiceId: proposal.invoiceId, note: proposal.note, createdAt: proposal.createdAt };
    const digest = createHash('sha256').update(JSON.stringify(reviewed)).digest('hex');
    const now = Date.now();
    database.prepare('INSERT INTO paypal_reminder_approvals VALUES (?, ?, ?, ?, ?, ?)')
      .run(approvalId, proposal.id, digest, new Date(now - 1000).toISOString(),
        new Date(now + 60000).toISOString(), 'local-terminal');
    let sends = 0;
    const executor = track(new ReminderExecutor(path));
    await assert.rejects(executor.execute(proposal.id, async () => {
      sends++;
      throw new Error('Synthetic ambiguous response');
    }), /outcome is unknown/);
    const attempt = database.prepare('SELECT * FROM paypal_reminder_attempts').get();
    assert.equal(attempt.state, 'unknown');
    close(executor);

    const reviews = track(new ReminderReconciliationStore(path));
    const operation = { proposalId: proposal.id, approvalId,
      attemptId: attempt.attempt_id, invoiceId: proposal.invoiceId };
    reviews.recordReview({ ...operation, outcome: 'unresolved',
      evidenceKind: 'invoice_read', evidenceReference: 'PRIVATE_INVOICE_EVIDENCE' });
    reviews.recordReview({ ...operation, outcome: 'reported_accepted',
      evidenceKind: 'reminder_record', evidenceReference: 'PRIVATE_REMINDER_EVIDENCE' });
    close(reviews);

    // A row sharing the proposal but referencing another attempt must stay excluded.
    database.prepare(`INSERT INTO paypal_reminder_reconciliation_reviews
      (review_id, proposal_id, approval_id, attempt_id, invoice_id, recorded_at,
       outcome, evidence_kind, evidence_reference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(randomUUID(), proposal.id, approvalId, randomUUID(), proposal.invoiceId,
        new Date().toISOString(), 'reported_not_accepted', 'support_confirmation',
        'UNRELATED_OPERATION_EVIDENCE');

    const reader = track(openSandboxConsoleHistory(path));
    const history = reader.getHistory(proposal.id);
    const result = history.timeline.find(entry => entry.stage === 'result');
    assert.equal(result.status, 'unknown');
    assert.equal(result.confirmed, false);
    assert.equal(result.uncertain, true);
    assert.equal(history.reconciliation.reviews.length, 2);
    assert.deepEqual(new Set(history.reconciliation.reviews.map(
      row => row.operatorReportedOutcome)), new Set(['unresolved', 'reported_accepted']));
    assert.equal(history.reconciliation.resendAllowed, false);
    assert.equal(history.reconciliation.independentlyVerified, false);
    assert.equal(history.reconciliation.recipientDeliveryVerified, false);
    for (const row of history.reconciliation.reviews) {
      assert.equal(row.proposalId, proposal.id);
      assert.equal(row.approvalId, approvalId);
      assert.equal(row.attemptId, attempt.attempt_id);
      assert.equal(row.invoiceId, proposal.invoiceId);
    }
    const serialized = JSON.stringify(history);
    for (const secret of ['PRIVATE_SYNTHETIC_MESSAGE', 'PRIVATE_INVOICE_EVIDENCE',
      'PRIVATE_REMINDER_EVIDENCE', 'UNRELATED_OPERATION_EVIDENCE', digest]) {
      assert.equal(serialized.includes(secret), false);
    }
    assert.deepEqual(database.prepare('SELECT * FROM paypal_reminder_attempts').get(), attempt);
    const reopened = track(new ReminderExecutor(path));
    await assert.rejects(reopened.execute(proposal.id, async () => { sends++; }));
    assert.equal(sends, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM paypal_reminder_attempts').get().n, 1);
  } finally {
    for (const connection of connections) connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
