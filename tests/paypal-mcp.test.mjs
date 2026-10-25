import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ProposalStore } from '../src/proposals.ts';
import { ReminderExecutor } from '../src/reminder-execution.ts';
import { createSandboxPayPalMcpServer } from '../src/paypal-mcp.ts';

test('sandbox MCP wiring reads through supplied adapters and prevents unapproved network calls',
  { timeout: 10000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paypal-mcp-wiring-'));
    const databasePath = join(directory, 'operations.sqlite');
    const proposals = new ProposalStore(databasePath);
    const executor = new ReminderExecutor(databasePath);
    const database = new DatabaseSync(databasePath);
    database.exec(`CREATE TABLE paypal_reminder_approvals (
      approval_id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL UNIQUE,
      payload_sha256 TEXT NOT NULL, approved_at TEXT NOT NULL,
      expires_at TEXT NOT NULL, approved_via TEXT NOT NULL
    )`);
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = async () => {
      networkCalls++;
      throw new Error('Unexpected network request in local wiring test');
    };
    const client = new Client({ name: 'wiring-test', version: '1.0.0' });
    let server;
    try {
      server = createSandboxPayPalMcpServer({
        environment: 'sandbox', clientId: 'test-fixture-credential-005',
        clientSecret: 'test-fixture-credential-006', webhookId: 'fictional-webhook',
        databasePath,
      }, {
        proposals, executor,
        listDisputes: async limit => ({ source: 'simulated-disputes', limit }),
        listUnpaidInvoices: async limit => ({ source: 'simulated-invoices', limit }),
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      for (const [name, source] of [
        ['list_disputes', 'simulated-disputes'],
        ['list_unpaid_invoices', 'simulated-invoices'],
      ]) {
        const result = await client.callTool({ name, arguments: { limit: 2 } });
        assert.notEqual(result.isError, true);
        assert.deepEqual(JSON.parse(result.content[0].text), { source, limit: 2 });
      }
      const draftResult = await client.callTool({
        name: 'propose_invoice_reminder',
        arguments: { requestId: 'wiring-request', invoiceId: 'INV-TEST', note: 'Local test only.' },
      });
      assert.notEqual(draftResult.isError, true);
      const proposal = JSON.parse(draftResult.content[0].text);
      assert.equal(typeof proposal.id, 'string');
      assert.ok(proposal.id.trim());
      assert.equal(database.prepare(
        'SELECT COUNT(*) AS n FROM paypal_reminder_proposals WHERE proposal_id = ?'
      ).get(proposal.id).n, 1);
      const execution = await client.callTool({
        name: 'execute_invoice_reminder', arguments: { proposalId: proposal.id },
      });
      assert.equal(execution.isError, true);
      assert.equal(networkCalls, 0);
      assert.equal(database.prepare(
        'SELECT COUNT(*) AS n FROM paypal_reminder_attempts'
      ).get().n, 0);
    } finally {
      try {
        await client.close();
      } finally {
        try {
          if (server) await server.close();
        } finally {
          globalThis.fetch = originalFetch;
          database.close();
          executor.close();
          proposals.close();
          rmSync(directory, { recursive: true, force: true });
        }
      }
    }
  });
