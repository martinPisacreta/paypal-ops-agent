import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export type ReminderProposal = {
  id: string;
  requestId: string;
  invoiceId: string;
  note: string;
  createdAt: string;
  status: 'pending';
};

function requireText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

// Drafts only. Creating or retrieving a proposal never authorizes a PayPal call.
// Human approval must be implemented through a separate operator interface.
export class ProposalStore {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS paypal_reminder_proposals (
        proposal_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        invoice_id TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status = 'pending')
      );
    `);
  }

  createReminder(input: {
    requestId: string;
    invoiceId: string;
    note: string;
  }): ReminderProposal {
    const requestId = requireText(input.requestId, 'request ID', 255);
    const invoiceId = requireText(input.invoiceId, 'invoice ID', 255);
    const note = requireText(input.note, 'reminder note', 1000);

    // The unique request key arbitrates retries across database connections.
    // A conflicting payload must never silently replace the original draft.
    this.database.prepare(`
      INSERT INTO paypal_reminder_proposals
        (proposal_id, request_id, invoice_id, note, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO NOTHING
    `).run(randomUUID(), requestId, invoiceId, note, new Date().toISOString());

    const row = this.database.prepare(`
      SELECT proposal_id, request_id, invoice_id, note, created_at, status
      FROM paypal_reminder_proposals WHERE request_id = ?
    `).get(requestId);

    if (!row || row.invoice_id !== invoiceId || row.note !== note) {
      throw new Error('Request ID already belongs to a different proposal');
    }
    if (typeof row.proposal_id !== 'string' ||
        typeof row.request_id !== 'string' ||
        typeof row.created_at !== 'string' || row.status !== 'pending') {
      throw new Error('Invalid stored proposal');
    }

    return {
      id: row.proposal_id,
      requestId: row.request_id,
      invoiceId,
      note,
      createdAt: row.created_at,
      status: 'pending',
    };
  }

  close(): void {
    this.database.close();
  }
}
