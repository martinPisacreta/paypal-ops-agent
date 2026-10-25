import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfiguration } from './config.ts';
import { ProposalStore } from './proposals.ts';
import { ReminderExecutor } from './reminder-execution.ts';
import { createSandboxPayPalMcpServer } from './paypal-mcp.ts';

async function main(): Promise<void> {
  const configuration = loadConfiguration(process.env, { requireWebhookId: false });
  mkdirSync(dirname(configuration.databasePath), {
    recursive: true, mode: 0o700,
  });
  const proposals = new ProposalStore(configuration.databasePath);
  let executor: ReminderExecutor;
  try {
    executor = new ReminderExecutor(configuration.databasePath);
  } catch (error) {
    proposals.close();
    throw error;
  }

  const server = createSandboxPayPalMcpServer(configuration, {
    proposals, executor,
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await server.close();
      } finally {
        try {
          executor.close();
        } finally {
          proposals.close();
        }
      }
    })();
    return closing;
  };
  const stop = (): void => {
    void close().catch(() => {
      process.stderr.write('PayPal MCP shutdown failed.\n');
      process.exitCode = 1;
    });
  };
  server.onclose = stop;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await close().catch(() => undefined);
    throw error;
  }
}

void main().catch(() => {
  // Keep stdout reserved for MCP and avoid disclosing configuration.
  process.stderr.write('PayPal sandbox MCP startup failed.\n');
  process.exitCode = 1;
});
