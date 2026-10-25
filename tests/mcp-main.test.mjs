import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const executable = fileURLToPath(new URL('../src/mcp-main.ts', import.meta.url));

function environment(databasePath) {
  return {
    ...process.env,
    PAYPAL_ENVIRONMENT: 'sandbox',
    PAYPAL_CLIENT_ID: 'test-fixture-credential-001',
    PAYPAL_CLIENT_SECRET: 'test-fixture-credential-002',
    PAYPAL_WEBHOOK_ID: 'fictional-startup-webhook',
    PAYPAL_DATABASE_PATH: databasePath,
  };
}

test('MCP executable starts over stdio and discovers tools without PayPal calls', { timeout: 10000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-mcp-main-'));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--experimental-strip-types', executable],
    env: environment(join(directory, 'nested', 'operations.sqlite')),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'executable-startup-test', version: '1.0.0' });
  let diagnostics = '';
  transport.stderr?.on('data', chunk => { diagnostics += chunk.toString(); });
  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.equal(result.tools.length, 4);
    assert.equal(new Set(result.tools.map(tool => tool.name)).size, 4);
    assert.equal(result.tools.some(tool => /approv/i.test(tool.name)), false);
  } finally {
    try {
      await client.close();
    } finally {
      try {
        await transport.close();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  }
  assert.equal(diagnostics.includes('test-fixture-credential-002'), false);
  assert.equal(diagnostics.includes('startup failed'), false);
  assert.equal(diagnostics.includes('shutdown failed'), false);
});

test('MCP executable rejects unsupported configuration without disclosing credentials', { timeout: 10000 }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'paypal-mcp-invalid-'));
  try {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', executable], {
      env: { ...environment(join(directory, 'operations.sqlite')), PAYPAL_ENVIRONMENT: 'production' },
      input: '',
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /PayPal sandbox MCP startup failed/);
    assert.equal(result.stderr.includes('test-fixture-credential-002'), false);
    assert.equal(result.stderr.includes('test-fixture-credential-001'), false);
    assert.equal(result.stderr.includes(directory), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
