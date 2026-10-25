import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Explicit operator command; preserves sanitized evidence inside the project.
// Usage: node --experimental-strip-types src/record-read-acceptance.ts direct|mcp
function main(): void {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || (mode !== 'direct' && mode !== 'mcp')) {
    throw new Error('Provide exactly one mode: direct or mcp');
  }
  const startedAt = new Date().toISOString();
  const executable = mode === 'mcp'
    ? './mcp-read-acceptance.ts' : './sandbox-read-acceptance.ts';
  const result = spawnSync(process.execPath, [
    '--experimental-strip-types',
    fileURLToPath(new URL(executable, import.meta.url)),
  ], {
    env: process.env,
    encoding: 'utf8',
    timeout: 45000,
    maxBuffer: 131072,
    killSignal: 'SIGTERM',
  });

  let payload: Record<string, unknown> = {};
  let reportParsed = false;
  try {
    const parsed: unknown = JSON.parse(result.stdout ?? '');
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
      reportParsed = true;
    }
  } catch {
    // Never include raw process output in persisted evidence.
  }

  const expected = mode === 'mcp'
    ? ['list_disputes', 'list_unpaid_invoices']
    : ['listDisputes', 'listUnpaidInvoices'];
  const supplied = Array.isArray(payload.checks) ? payload.checks : [];
  const checks = expected.map(operation => {
    const matches = supplied.filter((item: unknown) =>
      typeof item === 'object' && item !== null &&
      !Array.isArray(item) &&
      (item as Record<string, unknown>).operation === operation);
    return {
      operation,
      passed: matches.length === 1 &&
        (matches[0] as Record<string, unknown>).passed === true,
    };
  });
  const claimed = mode === 'mcp'
    ? payload.sandboxMcpReadsVerified : payload.sandboxReadsVerified;
  const verified = !result.error && result.status === 0 && reportParsed &&
    payload.environment === 'sandbox' && payload.configurationLoaded === true &&
    supplied.length === expected.length && checks.every(check => check.passed) &&
    claimed === true && (mode !== 'mcp' ||
      (payload.mcpConnected === true && payload.readToolsDiscovered === true));
  const report = {
    startedAt,
    completedAt: new Date().toISOString(),
    mode,
    environment: 'sandbox',
    exitCode: result.status,
    processFailed: Boolean(result.error) || result.signal !== null,
    reportParsed,
    configurationLoaded: payload.configurationLoaded === true,
    checks,
    sandboxReadsVerified: verified,
    fullSandboxAcceptanceVerified: false,
  };
  const directory = fileURLToPath(new URL('../acceptance/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  const artifact = join(directory, `recorded-${mode}-${randomUUID()}.json`);
  writeFileSync(artifact, JSON.stringify(report, null, 2) + '\n', {
    encoding: 'utf8', flag: 'wx', mode: 0o600,
  });
  process.stdout.write(JSON.stringify({ artifact, ...report }, null, 2) + '\n');
  if (!verified) process.exitCode = 1;
}

try {
  main();
} catch {
  process.stderr.write('Acceptance recording failed; inspect local configuration and file permissions.\n');
  process.exitCode = 1;
}
