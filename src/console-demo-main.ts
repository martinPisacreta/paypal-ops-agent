import { fileURLToPath } from 'node:url';
import { startDemoConsole } from './console-demo-server.js';
import { ProposalStore } from './proposals.js';

async function main(): Promise<void> {
  const databasePath = fileURLToPath(
    new URL('../demo-console.sqlite', import.meta.url),
  );
  const proposalStore = new ProposalStore(databasePath);
  let server: Awaited<ReturnType<typeof startDemoConsole>>;
  try {
    server = await startDemoConsole(8790, { proposalStore });
  } catch (error) {
    proposalStore.close();
    throw error;
  }

  console.log('Simulated operations console: http://127.0.0.1:8790');
  console.log('Demo proposal database: ' + databasePath);
  console.log('For terminal review, set PAYPAL_DATABASE_PATH to this database.');

  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close((error) => {
      try {
        proposalStore.close();
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
  console.error('Could not start the local demo console');
  process.exitCode = 1;
});
