import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const project = fileURLToPath(new URL('../', import.meta.url));

test('webhook executable initializes storage and exits cleanly on SIGTERM',
  { timeout: 15000 }, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'paypal-webhook-main-'));
    const databasePath = join(directory, 'nested', 'operations.sqlite');
    const child = spawn(process.execPath, [
      '--experimental-strip-types', 'src/webhook-main.ts',
    ], {
      cwd: project,
      env: {
        ...process.env,
        PAYPAL_ENVIRONMENT: 'sandbox',
        PAYPAL_CLIENT_ID: 'test-fixture-credential-005',
        PAYPAL_CLIENT_SECRET: 'test-fixture-credential-006',
        PAYPAL_WEBHOOK_ID: 'fictional-webhook',
        PAYPAL_DATABASE_PATH: databasePath,
        PAYPAL_WEBHOOK_PORT: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    let stderr = '';
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8');

    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error('Webhook executable did not become ready'));
        }, 8000);
        const onData = chunk => {
          stderr += chunk;
          if (stderr.includes('PayPal sandbox webhook listener ready.')) {
            cleanup();
            resolve();
          }
        };
        const onClose = () => {
          cleanup();
          reject(new Error('Webhook executable exited before readiness'));
        };
        const onError = error => { cleanup(); reject(error); };
        const cleanup = () => {
          clearTimeout(timer);
          child.stderr.off('data', onData);
          child.off('close', onClose);
          child.off('error', onError);
        };
        child.stderr.on('data', onData);
        child.once('close', onClose);
        child.once('error', onError);
      });

      assert.equal(existsSync(databasePath), true);
      assert.equal(child.kill('SIGTERM'), true);
      const [code, signal] = await closed;
      assert.equal(code, 0);
      assert.equal(signal, null);
      assert.equal(stdout, '');
      assert.doesNotMatch(stderr, /test-fixture-credential-006/);

      const database = new DatabaseSync(databasePath);
      try {
        assert.equal(database.prepare(
          'SELECT COUNT(*) AS n FROM paypal_webhook_inbox'
        ).get().n, 0);
      } finally { database.close(); }
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
      await closed.catch(() => undefined);
      rmSync(directory, { recursive: true, force: true });
    }
  });
