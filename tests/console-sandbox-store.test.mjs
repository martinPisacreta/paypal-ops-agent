import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProposalStore } from '../dist/proposals.js';
import { openSandboxConsoleHistory } from '../dist/console-sandbox-store.js';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'paypal-console-history-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'history.sqlite');
  const writer = new ProposalStore(path);
  let proposal;
  try {
    proposal = writer.createReminder({
      requestId: 'private-request-marker',
      invoiceId: 'INV2-TEST-001',
      note: 'secret-marker private@example.test 123 Private Street',
    });
  } finally { writer.close(); }
  return { path, proposal, directory };
}

test('console history lists proposals without exposing free-text fields', async t => {
  const { path, proposal } = await fixture(t);
  const reader = openSandboxConsoleHistory(path);
  try {
    const result = reader.listProposals();
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].proposalId, proposal.id);
    assert.equal(result.items[0].invoiceId, 'INV2-TEST-001');
    assert.equal(result.hasMore, false);
    const text = JSON.stringify(result);
    for (const value of ['secret-marker', 'private@example.test',
      '123 Private Street', 'private-request-marker']) {
      assert.equal(text.includes(value), false);
    }
  } finally { reader.close(); }
});

test('console history preserves proposal identity through the shared reader', async t => {
  const { path, proposal } = await fixture(t);
  const reader = openSandboxConsoleHistory(path);
  try {
    const history = reader.getHistory(proposal.id);
    assert.equal(history.found, true);
    const entry = history.timeline.find(item => item.stage === 'proposal');
    assert.ok(entry);
    assert.equal(entry.recorded, true);
    assert.equal(entry.data.proposalId, proposal.id);
    assert.equal(entry.data.invoiceId, 'INV2-TEST-001');
    const text = JSON.stringify(history);
    for (const value of ['secret-marker', 'private@example.test',
      '123 Private Street', 'private-request-marker']) {
      assert.equal(text.includes(value), false);
    }
  } finally { reader.close(); }
});

test('listing and history leave the existing database unchanged', async t => {
  const { path, proposal } = await fixture(t);
  const before = await readFile(path);
  const reader = openSandboxConsoleHistory(path);
  try {
    reader.listProposals();
    reader.getHistory(proposal.id);
    assert.throws(() => reader.getHistory('invalid-proposal'));
  } finally { reader.close(); }
  assert.deepEqual(await readFile(path), before);
});

test('opening a missing history database does not create it', async t => {
  const { directory } = await fixture(t);
  const missing = join(directory, 'missing.sqlite');
  assert.throws(() => openSandboxConsoleHistory(missing));
  await assert.rejects(access(missing), { code: 'ENOENT' });
});
