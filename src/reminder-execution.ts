import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ReminderSender = (input: {
  invoiceId: string;
  note: string;
  attemptId: string;
}) => Promise<void>;

// The sender must use sandbox credentials and disable automatic retries.
// attemptId is a local audit identifier, not a remote idempotency guarantee.
export class ReminderExecutor {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS paypal_reminder_attempts (
        attempt_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE,
        approval_id TEXT NOT NULL UNIQUE,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        state TEXT NOT NULL
          CHECK (state IN ('started', 'succeeded', 'unknown'))
      );
    `);
  }

  async execute(
    proposalId: string,
    send: ReminderSender,
  ): Promise<{ attemptId: string; status: 'succeeded' }> {
    if (typeof proposalId !== 'string' || !proposalId.trim() ||
        proposalId.length > 255 || typeof send !== 'function') {
      throw new Error('A proposal ID and configured sender are required');
    }

    const attemptId = randomUUID();
    let invoiceId: string;
    let note: string;
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database.prepare(`
        SELECT p.proposal_id, p.request_id, p.invoice_id, p.note,
               p.created_at, p.status, a.approval_id, a.payload_sha256,
               a.approved_at, a.expires_at, a.approved_via
        FROM paypal_reminder_proposals p
        JOIN paypal_reminder_approvals a ON a.proposal_id = p.proposal_id
        WHERE p.proposal_id = ?
      `).get(proposalId);
      if (!row || row.status !== 'pending' ||
          row.approved_via !== 'local-terminal') {
        throw new Error('An approved pending proposal is required');
      }
      for (const key of [
        'proposal_id', 'request_id', 'invoice_id', 'note', 'created_at',
        'approval_id', 'payload_sha256', 'approved_at', 'expires_at',
      ]) {
        if (typeof row[key] !== 'string' || !row[key]) {
          throw new Error('Invalid approval or proposal record');
        }
      }
      const approvedAt = Date.parse(row.approved_at as string);
      const expiresAt = Date.parse(row.expires_at as string);
      const now = Date.now();
      if (!Number.isFinite(approvedAt) || !Number.isFinite(expiresAt) ||
          approvedAt > now || expiresAt <= now ||
          expiresAt <= approvedAt || expiresAt - approvedAt > 900_000) {
        throw new Error('Approval is expired or invalid');
      }
      const reviewed = {
        proposalId: row.proposal_id,
        requestId: row.request_id,
        invoiceId: row.invoice_id,
        note: row.note,
        createdAt: row.created_at,
      };
      const digest = createHash('sha256')
        .update(JSON.stringify(reviewed)).digest('hex');
      if (digest !== row.payload_sha256) {
        throw new Error('Proposal differs from the approved content');
      }
      invoiceId = row.invoice_id as string;
      note = row.note as string;
      // Commit before invoking the sender. Unique keys prevent another
      // connection or a restarted process from resending this proposal.
      this.database.prepare(`
        INSERT INTO paypal_reminder_attempts
          (attempt_id, proposal_id, approval_id, started_at, state)
        VALUES (?, ?, ?, ?, 'started')
      `).run(attemptId, proposalId, row.approval_id, new Date(now).toISOString());
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }

    try {
      await send({ invoiceId, note, attemptId });
    } catch {
      this.database.prepare(`
        UPDATE paypal_reminder_attempts
        SET state = 'unknown', completed_at = ? WHERE attempt_id = ?
      `).run(new Date().toISOString(), attemptId);
      throw new Error('Reminder outcome is unknown; reconcile with PayPal before further action');
    }
    // A crash before this update leaves 'started', which also blocks retries.
    this.database.prepare(`
      UPDATE paypal_reminder_attempts
      SET state = 'succeeded', completed_at = ? WHERE attempt_id = ?
    `).run(new Date().toISOString(), attemptId);
    return { attemptId, status: 'succeeded' };
  }

  close(): void {
    this.database.close();
  }
}
