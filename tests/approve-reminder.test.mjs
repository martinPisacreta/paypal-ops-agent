import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { ProposalStore } from '../src/proposals.ts';
import { ReminderExecutor } from '../src/reminder-execution.ts';

const executable = fileURLToPath(new URL('../src/approve-reminder.ts', import.meta.url));
const driver = String.raw`
import errno, json, os, pty, select, sqlite3, subprocess, sys, time
node, executable, database, proposal, action = sys.argv[1:]
master, slave = pty.openpty()
child = subprocess.Popen([node, '--experimental-strip-types', executable, proposal],
    stdin=slave, stdout=slave, stderr=slave,
    env={**os.environ, 'PAYPAL_DATABASE_PATH': database})
os.close(slave)
output = bytearray()
answered = False
try:
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        if select.select([master], [], [], 0.1)[0]:
            try:
                data = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            output.extend(data)
        if not answered and b'to authorize this proposal: ' in output:
            if action == 'mutate':
                with sqlite3.connect(database) as connection:
                    connection.execute(
                        'UPDATE paypal_reminder_proposals SET note = ? WHERE proposal_id = ?',
                        ('Changed synthetic fixture', proposal))
            answer = 'CANCEL' if action == 'cancel' else 'APPROVE ' + json.dumps(proposal)
            os.write(master, (answer + '\n').encode())
            answered = True
    code = child.wait(timeout=2)
    print(json.dumps({'code': code, 'answered': answered, 'output': output.decode(errors='replace')}))
finally:
    os.close(master)
    if child.poll() is None:
        child.kill()
    child.wait()
`;

async function withFixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-approval-test-'));
  try {
    const databasePath = join(directory, 'operations.sqlite');
    const store = new ProposalStore(databasePath);
    let proposal;
    try {
      proposal = store.createReminder({
        requestId: 'synthetic-terminal-approval-test',
        invoiceId: 'INV-FICTIONAL-TEST',
        note: 'Synthetic fixture; never send to PayPal.',
      });
    } finally {
      store.close();
    }
    await run(databasePath, proposal);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function interact(databasePath, proposal, action) {
  const result = spawnSync('python3', [
    '-c', driver, process.execPath, executable, databasePath, proposal.id, action,
  ], { encoding: 'utf8', timeout: 12000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const terminal = JSON.parse(result.stdout);
  assert.equal(terminal.answered, true, terminal.output);
  return terminal;
}

function approvalCount(databasePath) {
  const database = new DatabaseSync(databasePath);
  try {
    const table = database.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'paypal_reminder_approvals'"
    ).get();
    return table ? database.prepare(
      'SELECT COUNT(*) AS count FROM paypal_reminder_approvals'
    ).get().count : 0;
  } finally {
    database.close();
  }
}

// All confirmations below apply only to temporary synthetic databases.
// The executor receives an in-memory sender; these tests never contact PayPal.
test('terminal approval authorizes the reviewed synthetic proposal once', { timeout: 15000 }, async () => {
  await withFixture(async (databasePath, proposal) => {
    const terminal = interact(databasePath, proposal, 'approve');
    assert.equal(terminal.code, 0, terminal.output);
    assert.match(terminal.output, /Approval recorded:/);
    assert.equal(approvalCount(databasePath), 1);
    const executor = new ReminderExecutor(databasePath);
    const sends = [];
    const sender = async input => { sends.push(input); };
    try {
      const result = await executor.execute(proposal.id, sender);
      assert.equal(result.status, 'succeeded');
      assert.equal(sends.length, 1);
      assert.equal(sends[0].invoiceId, proposal.invoiceId);
      assert.equal(sends[0].note, proposal.note);
      await assert.rejects(executor.execute(proposal.id, sender));
      assert.equal(sends.length, 1);
    } finally {
      executor.close();
    }
  });
});

test('terminal cancellation records no approval', { timeout: 15000 }, async () => {
  await withFixture(async (databasePath, proposal) => {
    const terminal = interact(databasePath, proposal, 'cancel');
    assert.equal(terminal.code, 0, terminal.output);
    assert.match(terminal.output, /Cancelled/);
    assert.equal(approvalCount(databasePath), 0);
  });
});

test('proposal changes during review prevent approval', { timeout: 15000 }, async () => {
  await withFixture(async (databasePath, proposal) => {
    const terminal = interact(databasePath, proposal, 'mutate');
    assert.equal(terminal.code, 1, terminal.output);
    assert.match(terminal.output, /Proposal changed during review/);
    assert.equal(approvalCount(databasePath), 0);
  });
});

test('piped confirmation cannot replace an interactive terminal', { timeout: 10000 }, async () => {
  await withFixture(async (databasePath, proposal) => {
    const result = spawnSync(process.execPath, [
      '--experimental-strip-types', executable, proposal.id,
    ], {
      env: { ...process.env, PAYPAL_DATABASE_PATH: databasePath },
      input: 'APPROVE ' + JSON.stringify(proposal.id) + '\n',
      encoding: 'utf8', timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /interactive local terminal/);
    assert.equal(approvalCount(databasePath), 0);
  });
});
