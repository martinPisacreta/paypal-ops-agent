import { DatabaseSync } from 'node:sqlite';
import { readReminderHistory } from './reminder-history.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function safeId(value: unknown): string | null {
  return typeof value === 'string' && uuid.test(value) ? value : null;
}
function invoiceId(value: unknown): string | null {
  return typeof value === 'string' && /^INV2-[A-Z0-9-]{1,250}$/.test(value)
    ? value : null;
}
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) return null;
  return value;
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}
function proposal(value: unknown) {
  const row = record(value);
  return {
    proposalId: safeId(row.proposal_id), invoiceId: invoiceId(row.invoice_id),
    createdAt: timestamp(row.created_at),
    draftStatus: row.status === 'pending' ? 'pending' : 'unknown',
  };
}
function stageData(stage: string, value: unknown) {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (stage === 'proposal') return proposal(row);
  if (stage === 'approval') return {
    approvalId: safeId(row.approval_id), proposalId: safeId(row.proposal_id),
    approvedAt: timestamp(row.approved_at), expiresAt: timestamp(row.expires_at),
  };
  return {
    attemptId: safeId(row.attempt_id), proposalId: safeId(row.proposal_id),
    approvalId: safeId(row.approval_id), startedAt: timestamp(row.started_at),
    completedAt: timestamp(row.completed_at),
    state: ['started', 'succeeded', 'unknown'].includes(String(row.state))
      ? row.state : 'unknown',
  };
}
function reviewData(value: unknown) {
  const row = record(value);
  const outcomes = ['unresolved', 'reported_accepted', 'reported_not_accepted'];
  const kinds = ['invoice_read', 'creation_webhook', 'reminder_record', 'support_confirmation'];
  return {
    reviewId: safeId(row.review_id), proposalId: safeId(row.proposal_id),
    approvalId: safeId(row.approval_id), attemptId: safeId(row.attempt_id),
    invoiceId: invoiceId(row.invoice_id), recordedAt: timestamp(row.recorded_at),
    operatorReportedOutcome: outcomes.includes(String(row.outcome)) ? row.outcome : 'unknown',
    evidenceKind: kinds.includes(String(row.evidence_kind)) ? row.evidence_kind : 'unknown',
  };
}

// Existing database only. Free-text messages and evidence references stay local.
export function openSandboxConsoleHistory(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  return {
    listProposals() {
      database.exec('BEGIN');
      try {
        const rows = database.prepare(
          'SELECT proposal_id, invoice_id, created_at, status ' +
          'FROM paypal_reminder_proposals ORDER BY created_at DESC, proposal_id LIMIT 101',
        ).all();
        const result = { items: rows.slice(0, 100).map(proposal),
          limit: 100, hasMore: rows.length > 100 };
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    getHistory(proposalId: string) {
      if (!safeId(proposalId)) throw new Error('Invalid proposal ID');
      const history = readReminderHistory(database, proposalId);
      return {
        proposalId, found: history.found, source: history.source,
        order: history.order, missingTables: history.missingTables,
        unknowns: history.unknowns, effects: history.effects,
        projection: 'Free-text messages, evidence references and internal fields are omitted.',
        timeline: history.timeline.map(entry => {
          const common = { stage: entry.stage, recorded: entry.recorded,
            at: timestamp(entry.at) };
          if (entry.stage === 'result' && 'confirmed' in entry) return {
            ...common, status: entry.status, confirmed: entry.confirmed,
            uncertain: entry.uncertain, recordedState: entry.recordedState,
            meaning: entry.meaning,
          };
          return { ...common, data: stageData(entry.stage,
            'data' in entry ? entry.data : null) };
        }),
        reconciliation: {
          available: history.reconciliation.available,
          source: history.reconciliation.source,
          reviews: history.reconciliation.reviews.map(reviewData),
          hasMore: history.reconciliation.hasMore,
          independentlyVerified: false, recipientDeliveryVerified: false,
          resendAllowed: false, meaning: history.reconciliation.meaning,
        },
      };
    },
    close() { database.close(); },
  };
}
