import { loadConfiguration } from './config.ts';
import { SandboxPayPalHttp } from './paypal-http.ts';
import { createSandboxDisputeReader } from './paypal-disputes.ts';
import { createSandboxUnpaidInvoiceReader } from './paypal-invoices.ts';

// Explicit acceptance command: performs authenticated sandbox reads only.
// Usage: node --experimental-strip-types src/sandbox-read-acceptance.ts
// Uses the same required configuration as the MCP executable.
// No response bodies, credentials, approvals or customer data are printed.
async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const checks: Array<{ operation: string; passed: boolean }> = [];
  let configurationLoaded = false;
  try {
    const configuration = loadConfiguration();
    configurationLoaded = true;
    const http = new SandboxPayPalHttp(configuration);
    const operations = [
      { name: 'listDisputes', read: createSandboxDisputeReader(http) },
      { name: 'listUnpaidInvoices', read: createSandboxUnpaidInvoiceReader(http) },
    ];
    for (const operation of operations) {
      try {
        await operation.read(1);
        checks.push({ operation: operation.name, passed: true });
      } catch {
        checks.push({ operation: operation.name, passed: false });
      }
    }
  } catch {
    // Deliberately omit underlying errors and configuration values.
  }
  const sandboxReadsVerified = configurationLoaded &&
    checks.length === 2 && checks.every(check => check.passed);
  process.stdout.write(JSON.stringify({
    startedAt,
    completedAt: new Date().toISOString(),
    environment: 'sandbox',
    configurationLoaded,
    requestedLimitPerRead: 1,
    checks,
    sandboxReadsVerified,
    reminderExecutionVerified: false,
    webhookDeliveryVerified: false,
    fullSandboxAcceptanceVerified: false,
  }, null, 2) + '\n');
  if (!sandboxReadsVerified) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write('Sandbox read acceptance failed.\n');
  process.exitCode = 1;
});
