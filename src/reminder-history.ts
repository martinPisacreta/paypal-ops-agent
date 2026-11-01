import type { DatabaseSync } from 'node:sqlite';

// Reads one consistent local snapshot without calling PayPal or changing records.
export function readReminderHistory(database: DatabaseSync, proposalId: string) {
  if (typeof proposalId !== 'string' || !proposalId.trim() || proposalId.length > 255)
    throw new Error('Invalid proposal ID');
  const missingTables: string[] = [];
  const exists = (table: string) => Boolean(database.prepare(
    'SELECT name FROM sqlite_master WHERE type = ? AND name = ?'
  ).get('table', table));
  const read = (table: string, sql: string) => {
    if (!exists(table)) { missingTables.push(table); return null; }
    return database.prepare(sql).get(proposalId) ?? null;
  };
  const timestamp = (value: unknown): string | null =>
    typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;

  database.exec('BEGIN');
  try {
    const proposal = read('paypal_reminder_proposals',
      'SELECT proposal_id, request_id, invoice_id, note, created_at, status FROM paypal_reminder_proposals WHERE proposal_id = ?');
    const approval = read('paypal_reminder_approvals',
      'SELECT approval_id, proposal_id, payload_sha256, approved_at, expires_at, approved_via FROM paypal_reminder_approvals WHERE proposal_id = ?');
    const attempt = read('paypal_reminder_attempts',
      'SELECT attempt_id, proposal_id, approval_id, started_at, completed_at, state FROM paypal_reminder_attempts WHERE proposal_id = ?');
    const startedAt = timestamp(attempt?.started_at);
    const completedAt = timestamp(attempt?.completed_at);
    const consistent = Boolean(proposal && approval && attempt &&
      attempt.proposal_id === proposal.proposal_id &&
      approval.proposal_id === proposal.proposal_id &&
      attempt.approval_id === approval.approval_id);
    const confirmed = consistent && attempt?.state === 'succeeded' &&
      startedAt !== null && completedAt !== null &&
      Date.parse(completedAt) >= Date.parse(startedAt);
    const status = confirmed ? 'succeeded' : attempt ? 'unknown' : 'not_recorded';
    const unknowns = [
      'Recipient delivery, inbox receipt and whether the recipient read the reminder are not verified.',
      'Current PayPal invoice status, payment status and remote reminder history are not checked.',
      'This is a local database snapshot, not independent confirmation from PayPal.',
      'The proposal pending field describes the stored draft; it does not override the execution record.',
      'A historical approval does not establish current permission to execute.',
    ];
    if (!confirmed) unknowns.push(attempt
      ? 'The local attempt has no consistent, confirmed successful result. Its remote outcome is uncertain; do not retry without reconciliation.'
      : 'No execution attempt is recorded in this snapshot. Absence of a local record does not prove that no remote action occurred.');
    if (missingTables.length)
      unknowns.push('Some history tables are absent; the corresponding stages are unavailable.');
    if (!proposal && (approval || attempt))
      unknowns.push('History contains records without the corresponding proposal.');
    if (attempt && (!approval || attempt.approval_id !== approval.approval_id))
      unknowns.push('The attempt cannot be matched to the stored approval.');

    const reviewsAvailable = exists('paypal_reminder_reconciliation_reviews');
    // Match all operation identifiers. Shared invoice IDs alone cannot correlate reviews.
    // Free-text evidence references remain in the local store and are not exposed here.
    const reviews = reviewsAvailable && consistent ? database.prepare(`
      SELECT review_id, proposal_id, approval_id, attempt_id, invoice_id,
             recorded_at, outcome, evidence_kind
      FROM paypal_reminder_reconciliation_reviews
      WHERE proposal_id = ? AND approval_id = ? AND attempt_id = ? AND invoice_id = ?
      ORDER BY recorded_at, review_id LIMIT 101
    `).all(proposalId, approval!.approval_id, attempt!.attempt_id, proposal!.invoice_id) : [];
    const reconciliation = {
      available: reviewsAvailable,
      source: 'Local operator observations; evidence is not independently verified.',
      reviews: reviews.slice(0, 100),
      hasMore: reviews.length > 100,
      independentlyVerified: false,
      recipientDeliveryVerified: false,
      resendAllowed: false,
      meaning: 'Reviews preserve the original execution result and never authorize another send.',
    };
    const history = {
      proposalId, found: proposal !== null,
      source: 'Local SQLite snapshot only; no PayPal API request.',
      order: 'Workflow stages: proposal, approval, execution attempt, result. Missing stages remain explicit.',
      timeline: [
        { stage: 'proposal', recorded: proposal !== null,
          at: timestamp(proposal?.created_at), data: proposal },
        { stage: 'approval', recorded: approval !== null,
          at: timestamp(approval?.approved_at), data: approval },
        { stage: 'execution_attempt', recorded: attempt !== null,
          at: startedAt, data: attempt },
        { stage: 'result', recorded: attempt !== null, at: completedAt,
          status, confirmed, uncertain: !confirmed, recordedState: attempt?.state ?? null,
          meaning: confirmed
            ? 'The local executor recorded a successful sender return. Recipient delivery remains unverified.'
            : 'No confirmed successful local execution result is available.' },
      ],
      reconciliation, missingTables, unknowns,
      effects: { persisted: false, approved: false, executed: false, apiCalled: false },
    };
    database.exec('COMMIT');
    return history;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
