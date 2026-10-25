import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';

// Operator-only CLI. Do not expose this command as an MCP tool.
// This records approval; it never calls PayPal.
// Usage: node --experimental-strip-types src/approve-reminder.ts PROPOSAL_ID
// PAYPAL_DATABASE_PATH must identify the existing proposal database.
async function main(): Promise<void> {
  if (!stdin.isTTY || !stdout.isTTY) {
    throw new Error('Human approval requires an interactive local terminal');
  }
  const proposalId = process.argv[2];
  const configuredPath = process.env.PAYPAL_DATABASE_PATH;
  if (!proposalId || process.argv.length !== 3 || !configuredPath) {
    throw new Error('Provide one proposal ID and set PAYPAL_DATABASE_PATH');
  }
  const databasePath = resolve(configuredPath);
  if (!existsSync(databasePath)) {
    throw new Error('The existing proposal database was not found');
  }

  const database = new DatabaseSync(databasePath);
  try {
    database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS paypal_reminder_approvals (
        approval_id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL UNIQUE
          REFERENCES paypal_reminder_proposals(proposal_id),
        payload_sha256 TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        approved_via TEXT NOT NULL CHECK (approved_via = 'local-terminal')
      );
    `);

    const readProposal = () => {
      const row = database.prepare(`
        SELECT proposal_id, request_id, invoice_id, note, created_at, status
        FROM paypal_reminder_proposals WHERE proposal_id = ?
      `).get(proposalId);
      if (!row || row.status !== 'pending' ||
          typeof row.proposal_id !== 'string' ||
          typeof row.request_id !== 'string' ||
          typeof row.invoice_id !== 'string' ||
          typeof row.note !== 'string' ||
          typeof row.created_at !== 'string') {
        throw new Error('A valid pending proposal is required');
      }
      return {
        proposalId: row.proposal_id,
        requestId: row.request_id,
        invoiceId: row.invoice_id,
        note: row.note,
        createdAt: row.created_at,
      };
    };
    const digest = (value: ReturnType<typeof readProposal>) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');

    const proposal = readProposal();
    const expectedDigest = digest(proposal);
    // JSON escaping prevents proposal text from injecting terminal controls.
    stdout.write('Review the exact reminder proposal:\n');
    stdout.write(JSON.stringify(proposal, null, 2) + '\n');
    stdout.write('Approval expires after 15 minutes. No reminder is sent here.\n');
    const terminal = createInterface({ input: stdin, output: stdout });
    let answer: string;
    try {
      answer = await terminal.question(
        `Type APPROVE ${JSON.stringify(proposalId)} to authorize this proposal: `,
      );
    } finally {
      terminal.close();
    }
    if (answer !== `APPROVE ${JSON.stringify(proposalId)}`) {
      stdout.write('Cancelled. No approval recorded.\n');
      return;
    }

    database.exec('BEGIN IMMEDIATE');
    try {
      if (digest(readProposal()) !== expectedDigest) {
        throw new Error('Proposal changed during review; review it again');
      }
      const approvedAt = new Date();
      const approvalId = randomUUID();
      // A unique proposal key prevents concurrent or repeated authorizations.
      database.prepare(`
        INSERT INTO paypal_reminder_approvals
          (approval_id, proposal_id, payload_sha256, approved_at,
           expires_at, approved_via)
        VALUES (?, ?, ?, ?, ?, 'local-terminal')
      `).run(
        approvalId, proposalId, expectedDigest, approvedAt.toISOString(),
        new Date(approvedAt.getTime() + 15 * 60_000).toISOString(),
      );
      database.exec('COMMIT');
      stdout.write(`Approval recorded: ${approvalId}\n`);
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Approval failed';
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
});
