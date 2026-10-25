import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadConfiguration } from './config.ts';

// Authenticated sandbox reads through the actual stdio MCP executable.
// Never creates proposals, approvals or reminder execution requests.
async function main(): Promise<void> {
  const report = {
    startedAt: new Date().toISOString(),
    completedAt: '',
    environment: 'sandbox',
    configurationLoaded: false,
    mcpConnected: false,
    readToolsDiscovered: false,
    checks: [] as Array<{ operation: string; passed: boolean }>,
    sandboxMcpReadsVerified: false,
    fullSandboxAcceptanceVerified: false,
  };
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;
  let cleanupPassed = true;
  try {
    const configuration = loadConfiguration(process.env, { requireWebhookId: false });
    report.configurationLoaded = true;
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value !== undefined) env[key] = value;
    }
    Object.assign(env, {
      PAYPAL_ENVIRONMENT: configuration.environment,
      PAYPAL_CLIENT_ID: configuration.clientId,
      PAYPAL_CLIENT_SECRET: configuration.clientSecret,
      PAYPAL_WEBHOOK_ID: configuration.webhookId,
      PAYPAL_DATABASE_PATH: configuration.databasePath,
    });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--experimental-strip-types',
        fileURLToPath(new URL('./mcp-main.ts', import.meta.url)),
      ],
      env,
      stderr: 'pipe',
    });
    // Drain child diagnostics without recording potentially sensitive output.
    transport.stderr?.on('data', () => {});
    client = new Client({ name: 'paypal-sandbox-read-acceptance', version: '1.0.0' });
    await client.connect(transport, { timeout: 15000 });
    report.mcpConnected = true;
    const names = ['list_disputes', 'list_unpaid_invoices'];
    const discovered = await client.listTools({}, { timeout: 15000 });
    report.readToolsDiscovered = names.every(name =>
      discovered.tools.some(tool => tool.name === name));
    if (!report.readToolsDiscovered) throw new Error('Read tools unavailable');

    for (const name of names) {
      let passed = false;
      try {
        const result = await client.callTool(
          { name, arguments: { limit: 1 } },
          undefined,
          { timeout: 15000 },
        );
        if (result.isError !== true && Array.isArray(result.content) &&
            result.content.length === 1) {
          const block = result.content[0];
          if (block.type === 'text' && typeof block.text === 'string') {
            const payload: unknown = JSON.parse(block.text);
            passed = typeof payload === 'object' && payload !== null &&
              !Array.isArray(payload) &&
              Array.isArray((payload as Record<string, unknown>).items);
          }
        }
      } catch {
        // Keep raw tool responses and underlying errors out of the report.
      }
      report.checks.push({ operation: name, passed });
    }
  } catch {
    // Configuration, transport and discovery failures remain unverified.
  } finally {
    try {
      await client?.close();
    } catch {
      cleanupPassed = false;
    }
    try {
      await transport?.close();
    } catch {
      cleanupPassed = false;
    }
  }
  report.sandboxMcpReadsVerified = report.configurationLoaded &&
    report.mcpConnected && report.readToolsDiscovered && cleanupPassed &&
    report.checks.length === 2 && report.checks.every(check => check.passed);
  report.completedAt = new Date().toISOString();
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (!report.sandboxMcpReadsVerified) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write('Sandbox MCP read acceptance failed.\n');
  process.exitCode = 1;
});
