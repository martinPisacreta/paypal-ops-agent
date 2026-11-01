import { fileURLToPath } from 'node:url';
import { startDemoConsole, type DemoConsoleOptions } from './console-demo-server.js';
import { ProposalStore } from './proposals.js';
import { loadConfiguration } from './config.js';
import { SandboxPayPalHttp } from './paypal-http.js';
import { createSandboxUnpaidInvoiceReader } from './paypal-invoices.js';
import { openSandboxConsoleHistory } from './console-sandbox-store.js';

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.some(value => value !== '--sandbox') ||
      argumentsList.length > 1) {
    throw new Error('Use no arguments or --sandbox');
  }
  const sandbox = argumentsList.includes('--sandbox');
  const options: DemoConsoleOptions = {};
  let closeStorage: () => void = () => {};
  let server: Awaited<ReturnType<typeof startDemoConsole>>;

  try {
    if (sandbox) {
      const configuration = loadConfiguration(process.env, {
        requireWebhookId: false,
      });
      const http = new SandboxPayPalHttp(configuration);
      const history = openSandboxConsoleHistory(configuration.databasePath);
      closeStorage = () => history.close();
      options.sandboxReads = {
        readInvoices: createSandboxUnpaidInvoiceReader(http),
        listProposals: () => history.listProposals(),
        getHistory: proposalId => history.getHistory(proposalId),
      };
      // No writable proposal store is supplied in sandbox mode.
      // Fictional fixtures remain separate; draft persistence is disabled.
    } else {
      const databasePath = fileURLToPath(
        new URL('../demo-console.sqlite', import.meta.url),
      );
      const proposalStore = new ProposalStore(databasePath);
      closeStorage = () => proposalStore.close();
      options.proposalStore = proposalStore;
    }
    server = await startDemoConsole(8790, options);
  } catch (error) {
    closeStorage();
    throw error;
  }

  console.log(sandbox
    ? 'Local console ready: /sandbox is read-only; / contains fictional fixtures.'
    : 'Local fictional console ready: /. Use --sandbox for sandbox reading.');
  console.log('Approval requires the terminal; execution requires MCP.');

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(error => {
      try {
        closeStorage();
      } catch {
        process.exitCode = 1;
      }
      if (error) process.exitCode = 1;
    });
    server.closeAllConnections();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch(() => {
  console.error('Could not start the local console; check sandbox configuration.');
  process.exitCode = 1;
});
