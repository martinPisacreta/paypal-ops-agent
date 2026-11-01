import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

type ReviewOutcome = 'unresolved' | 'reported_accepted' | 'reported_not_accepted';
type EvidenceKind = 'invoice_read' | 'creation_webhook' | 'reminder_record' | 'support_confirmation';

export interface ReminderReview {
  proposalId: string;
  approvalId: string;
  attemptId: string;
  invoiceId: string;
  outcome: ReviewOutcome;
  evidenceKind: EvidenceKind;
  evidenceReference: string;
}

// Local operator observations only. This class has no sender or network client.
// Reviews never change attempts, consume approvals or grant resend permission.
export class ReminderReconciliationStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS paypal_reminder_reconciliation_reviews (
        review_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        approval_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN
          ('unresolved', 'reported_accepted', 'reported_not_accepted')),
        evidence_kind TEXT NOT NULL CHECK (evidence_kind IN
          ('invoice_read', 'creation_webhook', 'reminder_record', 'support_confirmation')),
        evidence_reference TEXT NOT NULL
      );
    `);
  }

  recordReview(input: ReminderReview) {
    if (!input || !['proposalId', 'approvalId', 'attemptId', 'invoiceId'].every(key => {
      const value = input[key as keyof ReminderReview];
      return typeof value === 'string' && value.trim() && value.length <= 255;
    })) throw new Error('Complete operation identifiers are required');
    if (!['unresolved', 'reported_accepted', 'reported_not_accepted'].includes(input.outcome) ||
        !['invoice_read', 'creation_webhook', 'reminder_record', 'support_confirmation']
          .includes(input.evidenceKind)) throw new Error('Invalid reconciliation review');
    if (typeof input.evidenceReference !== 'string' ||
        !input.evidenceReference.trim() || input.evidenceReference.length > 1000)
      throw new Error('A bounded local evidence reference is required');
    if (input.outcome !== 'unresolved' &&
        !['reminder_record', 'support_confirmation'].includes(input.evidenceKind))
      throw new Error('Invoice reads and creation webhooks cannot resolve reminder outcomes');

    const reviewId = randomUUID();
    const recordedAt = new Date().toISOString();
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const operation = this.database.prepare(`
        SELECT t.state FROM paypal_reminder_attempts t
        JOIN paypal_reminder_proposals p ON p.proposal_id = t.proposal_id
        JOIN paypal_reminder_approvals a
          ON a.approval_id = t.approval_id AND a.proposal_id = t.proposal_id
        WHERE t.attempt_id = ? AND t.proposal_id = ?
          AND t.approval_id = ? AND p.invoice_id = ?
      `).get(input.attemptId, input.proposalId, input.approvalId, input.invoiceId);
      if (!operation) throw new Error('Evidence must match one recorded operation');
      this.database.prepare(`
        INSERT INTO paypal_reminder_reconciliation_reviews
          (review_id, proposal_id, approval_id, attempt_id, invoice_id,
           recorded_at, outcome, evidence_kind, evidence_reference)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(reviewId, input.proposalId, input.approvalId, input.attemptId,
        input.invoiceId, recordedAt, input.outcome, input.evidenceKind,
        input.evidenceReference);
      this.database.exec('COMMIT');
      return { reviewId, recordedAt, recordedExecutionState: operation.state,
        operatorReportedOutcome: input.outcome, independentlyVerified: false,
        recipientDeliveryVerified: false, resendAllowed: false };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void { this.database.close(); }
}
