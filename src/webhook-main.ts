import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadConfiguration } from './config.ts';
import { SandboxPayPalHttp } from './paypal-http.ts';
import { createSandboxWebhookVerifier } from './paypal-webhook.ts';
import { WebhookInbox } from './webhooks.ts';
import { createWebhookServer } from './webhook-http.ts';
import type { SignatureVerifier } from './webhooks.ts';

async function main(): Promise<void> {
  const configuration = loadConfiguration({
    ...process.env,
    PAYPAL_DATABASE_PATH: process.env.PAYPAL_DATABASE_PATH ?? './data/operations.sqlite',
  }, { requireWebhookId: false });
  const portText = process.env.PAYPAL_WEBHOOK_PORT ?? '8787';
  if (!/^\d{1,5}$/.test(portText) || Number(portText) > 65535) {
    throw new Error('Invalid webhook port');
  }
  const port = Number(portText);

  // Before registration, reject every delivery without persisting it.
  // Restart after saving the real webhook ID to enable PayPal verification.
  const verifySignature: SignatureVerifier = configuration.webhookId
    ? createSandboxWebhookVerifier(configuration, new SandboxPayPalHttp(configuration))
    : async () => {
      throw new Error('Webhook registration is not configured');
    };

  mkdirSync(dirname(configuration.databasePath), { recursive: true, mode: 0o700 });
  const inbox = new WebhookInbox(configuration.databasePath);
  const server = createWebhookServer(inbox, verifySignature);

  try {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        server.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
  } catch (error) {
    inbox.close();
    throw error;
  }

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(error => {
      try {
        inbox.close();
      } catch {
        process.exitCode = 1;
      } finally {
        process.removeListener('SIGINT', shutdown);
        process.removeListener('SIGTERM', shutdown);
      }
      if (error) process.exitCode = 1;
    });
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  server.on('error', () => {
    process.stderr.write('Webhook listener error.\n');
    process.exitCode = 1;
    shutdown();
  });
  process.stderr.write(configuration.webhookId
    ? 'PayPal sandbox webhook listener ready.\n'
    : 'PayPal sandbox webhook listener ready; deliveries unavailable until registration.\n');
}

void main().catch(() => {
  process.stderr.write('Webhook startup failed; check configuration and local resources.\n');
  process.exitCode = 1;
});
