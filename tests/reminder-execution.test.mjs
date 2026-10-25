import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ProposalStore } from '../src/proposals.ts';
import { ReminderExecutor } from '../src/reminder-execution.ts';

// Synthetic approvals and senders only. These tests do not validate human
// authentication, interactive approval, or the real PayPal integration.
async function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-execution-test-'));
  const path = join(directory, 'operations.sqlite');
  const connections = new Set();
  const track = connection => { connections.add(connection); return connection; };
  const close = connection => { connection.close(); connections.delete(connection); };
  try {
    const proposals = track(new ProposalStore(path));
    const proposal = proposals.createReminder({
      requestId: 'fictional-request', invoiceId: 'fictional-invoice',
      note: 'Fictional reminder; never sent to PayPal.',
    });
    const database = track(new DatabaseSync(path));
    database.exec(`CREATE TABLE paypal_reminder_approvals (
      approval_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,
      payload_sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, approved_via TEXT NOT NULL
    )`);
    const approve = (overrides = {}) => {
      const reviewed = {
        proposalId: proposal.id, requestId: proposal.requestId,
        invoiceId: proposal.invoiceId, note: proposal.note,
        createdAt: proposal.createdAt,
      };
      const now = Date.now();
      const approval = {
        digest: createHash('sha256').update(JSON.stringify(reviewed)).digest('hex'),
        approvedAt: new Date(now - 1000).toISOString(),
        expiresAt: new Date(now + 60000).toISOString(),
        via: 'local-terminal', ...overrides,
      };
      database.prepare(`INSERT INTO paypal_reminder_approvals
        VALUES (?, ?, ?, ?, ?, ?)`).run(randomUUID(), proposal.id,
        approval.digest, approval.approvedAt, approval.expiresAt, approval.via);
    };
    const openExecutor = () => track(new ReminderExecutor(path));
    await run({ proposal, database, approve, openExecutor, close });
  } finally {
    for (const connection of connections) connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test('missing approval prevents sender invocation and attempt creation', async () => {
  await fixture(async ({ proposal, database, openExecutor }) => {
    let calls = 0;
    await assert.rejects(openExecutor().execute(proposal.id, async () => { calls++; }),
      /approved pending proposal/);
    assert.equal(calls, 0);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM paypal_reminder_attempts').get().n, 0);
  });
});

test('invalid approval timing, origin and digest prevent sending', async t => {
  const now = Date.now();
  const cases = [
    ['expired', { approvedAt: new Date(now - 60000).toISOString(), expiresAt: new Date(now - 1000).toISOString() }],
    ['future', { approvedAt: new Date(now + 60000).toISOString(), expiresAt: new Date(now + 120000).toISOString() }],
    ['excessive lifetime', { approvedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 1000000).toISOString() }],
    ['invalid date', { expiresAt: 'invalid' }],
    ['wrong origin', { via: 'mcp' }],
    ['wrong digest', { digest: 'incorrect' }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => fixture(async ({ proposal, database, approve, openExecutor }) => {
      approve(overrides);
      let calls = 0;
      await assert.rejects(openExecutor().execute(proposal.id, async () => { calls++; }));
      assert.equal(calls, 0);
      assert.equal(database.prepare('SELECT COUNT(*) AS n FROM paypal_reminder_attempts').get().n, 0);
    }));
  }
});

test('changing reviewed content invalidates approval', async () => {
  await fixture(async ({ proposal, database, approve, openExecutor }) => {
    approve();
    database.prepare('UPDATE paypal_reminder_proposals SET note = ? WHERE proposal_id = ?')
      .run('Changed after review', proposal.id);
    let calls = 0;
    await assert.rejects(openExecutor().execute(proposal.id, async () => { calls++; }),
      /differs from the approved content/);
    assert.equal(calls, 0);
  });
});

test('committed attempt blocks concurrent execution and retries after reopening', async () => {
  await fixture(async ({ proposal, database, approve, openExecutor, close }) => {
    approve();
    const first = openExecutor();
    const second = openExecutor();
    let calls = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let sent;
    const pending = first.execute(proposal.id, async input => {
      calls++;
      sent = input;
      assert.equal(database.prepare('SELECT state FROM paypal_reminder_attempts').get().state, 'started');
      await barrier;
    });
    try {
      assert.equal(calls, 1);
      await assert.rejects(second.execute(proposal.id, async () => { calls++; }));
      assert.equal(calls, 1);
    } finally { release(); }
    const result = await pending;
    assert.equal(result.status, 'succeeded');
    assert.deepEqual(sent, { invoiceId: proposal.invoiceId, note: proposal.note, attemptId: result.attemptId });
    assert.equal(database.prepare('SELECT state FROM paypal_reminder_attempts').get().state, 'succeeded');
    close(first);
    close(second);
    await assert.rejects(openExecutor().execute(proposal.id, async () => { calls++; }));
    assert.equal(calls, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM paypal_reminder_attempts').get().n, 1);
  });
});

test('ambiguous sender failure remains blocked after reopening', async () => {
  await fixture(async ({ proposal, database, approve, openExecutor, close }) => {
    approve();
    const executor = openExecutor();
    let calls = 0;
    await assert.rejects(executor.execute(proposal.id, async () => {
      calls++;
      throw new Error('Simulated timeout after possible upstream acceptance');
    }), /outcome is unknown/);
    assert.equal(database.prepare('SELECT state FROM paypal_reminder_attempts').get().state, 'unknown');
    close(executor);
    await assert.rejects(openExecutor().execute(proposal.id, async () => { calls++; }));
    assert.equal(calls, 1);
  });
});

test('persisted unfinished attempt blocks sending after restart', async () => {
  await fixture(async ({ proposal, database, approve, openExecutor, close }) => {
    approve();
    const executor = openExecutor();
    const approval = database.prepare('SELECT approval_id FROM paypal_reminder_approvals').get();
    database.prepare(`INSERT INTO paypal_reminder_attempts
      (attempt_id, proposal_id, approval_id, started_at, state)
      VALUES (?, ?, ?, ?, 'started')`).run(randomUUID(), proposal.id,
        approval.approval_id, new Date().toISOString());
    close(executor);
    let calls = 0;
    await assert.rejects(openExecutor().execute(proposal.id, async () => { calls++; }));
    assert.equal(calls, 0);
    assert.equal(database.prepare('SELECT state FROM paypal_reminder_attempts').get().state, 'started');
  });
});
