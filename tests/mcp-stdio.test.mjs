import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Real MCP stdio transport and application persistence; simulated PayPal only.
const fixtureSource = `
import { DatabaseSync } from 'node:sqlite';
import { ProposalStore } from './src/proposals.ts';
import { ReminderExecutor } from './src/reminder-execution.ts';
import { startStdioMcpServer } from './src/mcp-server.ts';

const databasePath = process.argv[1];
const proposals = new ProposalStore(databasePath);
const executor = new ReminderExecutor(databasePath);
const database = new DatabaseSync(databasePath);
database.exec([
  'CREATE TABLE paypal_reminder_approvals (',
  'approval_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,',
  'payload_sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,',
  'expires_at TEXT NOT NULL, approved_via TEXT NOT NULL)'
].join(' '));
database.close();
await startStdioMcpServer({
  proposals, executor,
  listDisputes: async limit => ({ simulated: true, kind: 'disputes', limit }),
  listUnpaidInvoices: async limit => ({ simulated: true, kind: 'invoices', limit }),
  sendReminder: async () => {
    const audit = new DatabaseSync(databasePath);
    try {
      audit.prepare('INSERT INTO test_sender_calls VALUES (1)').run();
    } finally { audit.close(); }
    throw new Error('Unexpected simulated sender invocation');
  },
});
`;

function payload(result) {
  assert.notEqual(result.isError, true);
  assert.equal(result.content[0].type, 'text');
  return JSON.parse(result.content[0].text);
}

test('stdio MCP discovers tools, reads simulated data and blocks unapproved execution',
  { timeout: 15000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paypal-mcp-stdio-'));
    const databasePath = join(directory, 'operations.sqlite');
    const audit = new DatabaseSync(databasePath);
    try {
      audit.exec('CREATE TABLE test_sender_calls (called INTEGER)');
    } finally { audit.close(); }

    const client = new Client({ name: 'local-acceptance-test', version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--experimental-strip-types', '--input-type=module', '-e',
        fixtureSource, databasePath],
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stderr: 'inherit',
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      assert.deepEqual(listed.tools.map(tool => tool.name).sort(), [
        'execute_invoice_reminder', 'list_disputes',
        'list_unpaid_invoices', 'propose_invoice_reminder',
      ]);
      assert.deepEqual(payload(await client.callTool({
        name: 'list_disputes', arguments: {},
      })), { simulated: true, kind: 'disputes', limit: 25 });
      assert.deepEqual(payload(await client.callTool({
        name: 'list_unpaid_invoices', arguments: { limit: 3 },
      })), { simulated: true, kind: 'invoices', limit: 3 });

      const input = { requestId: 'stdio-fictional-request',
        invoiceId: 'stdio-fictional-invoice', note: 'Simulated reminder only.' };
      const proposal = payload(await client.callTool({
        name: 'propose_invoice_reminder', arguments: input,
      }));
      assert.equal(proposal.status, 'pending');
      assert.deepEqual(payload(await client.callTool({
        name: 'propose_invoice_reminder', arguments: input,
      })), proposal);

      const rejected = await client.callTool({
        name: 'execute_invoice_reminder',
        arguments: { proposalId: proposal.id },
      });
      assert.equal(rejected.isError, true);
      const database = new DatabaseSync(databasePath);
      try {
        assert.equal(database.prepare(
          'SELECT COUNT(*) AS n FROM paypal_reminder_attempts'
        ).get().n, 0);
        assert.equal(database.prepare(
          'SELECT COUNT(*) AS n FROM test_sender_calls'
        ).get().n, 0);
      } finally { database.close(); }
    } finally {
      try { await client.close(); }
      finally {
        try { await transport.close(); }
        finally { rmSync(directory, { recursive: true, force: true }); }
      }
    }
  });
