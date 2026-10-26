import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const evidencePath = fileURLToPath(new URL('data/webhook-test-invoice.json', root));
const base = 'https://api-m.sandbox.paypal.com';
let stage = 'preflight';
let evidence;

async function main() {
  if (existsSync(evidencePath)) throw new Error('Existing attempt requires reconciliation');
  const env = parseEnv(readFileSync(new URL('.env', root), 'utf8'));
  if ((env.PAYPAL_ENVIRONMENT ?? 'sandbox') !== 'sandbox' ||
      !env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET || !env.PAYPAL_WEBHOOK_ID) {
    throw new Error('Sandbox configuration incomplete');
  }

  // Establish that the POST-only receiver is reachable before creating anything.
  const port = process.env.PAYPAL_WEBHOOK_PORT ?? '8787';
  const local = await fetch('http://127.0.0.1:' + port + '/webhooks/paypal', {
    redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  await local.body?.cancel();
  if (local.status !== 405) throw new Error('Receiver preflight failed');

  stage = 'authentication';
  const auth = await fetch(base + '/v1/oauth2/token', {
    method: 'POST', redirect: 'error',
    headers: {
      Authorization: 'Basic ' + Buffer.from(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(30000),
  });
  if (!auth.ok) throw new Error('Authentication failed');
  const token = (await auth.json()).access_token;
  if (typeof token !== 'string' || !token) throw new Error('Missing token');

  mkdirSync(new URL('data/', root), { recursive: true, mode: 0o700 });
  evidence = {
    recordedAt: new Date().toISOString(),
    requestId: randomUUID(),
    outcome: 'prepared',
    environment: 'sandbox',
    invoiceSent: false,
    signatureVerificationConfirmed: false,
    deduplicationConfirmed: false,
  };
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), { flag: 'wx', mode: 0o600 });

  // Record the attempt before the request. Never retry an uncertain creation automatically.
  stage = 'create-draft';
  evidence.outcome = 'request-started';
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  const response = await fetch(base + '/v2/invoicing/invoices', {
    method: 'POST', redirect: 'error',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      'PayPal-Request-Id': evidence.requestId,
    },
    body: JSON.stringify({
      detail: { currency_code: 'USD', note: 'Fictional sandbox webhook acceptance test. Keep as draft.' },
      primary_recipients: [{ billing_info: { email_address: 'fictional-buyer@example.com' } }],
      items: [{ name: 'Fictional webhook acceptance item', quantity: '1', unit_amount: { currency_code: 'USD', value: '1.00' } }],
    }),
    signal: AbortSignal.timeout(30000),
  });
  evidence.httpStatus = response.status;
  if (!response.ok) {
    evidence.outcome = 'http-error-requires-reconciliation';
    throw new Error('Draft creation rejected');
  }
  const invoice = await response.json();
  if (typeof invoice.id !== 'string' || !/^INV2-[A-Z0-9-]+$/.test(invoice.id)) {
    throw new Error('Creation response requires reconciliation');
  }
  evidence.invoiceId = invoice.id;
  evidence.invoiceStatus = typeof invoice.status === 'string' ? invoice.status : null;
  evidence.outcome = 'created';
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2));
  console.log('Fictional sandbox draft invoice ' + invoice.id + ' created (not sent). PayPal should now deliver INVOICING.INVOICE.CREATED to the registered webhook; evidence saved in data/webhook-test-invoice.json.');
}

main().catch(() => {
  if (evidence) {
    if (evidence.outcome === 'request-started') evidence.outcome = 'uncertain-requires-reconciliation';
    evidence.failedStage = stage;
    try { writeFileSync(evidencePath, JSON.stringify(evidence, null, 2)); } catch {}
  }
  console.error('Draft acceptance stopped at stage: ' + stage + '. No automatic retry performed; inspect private evidence before another attempt.');
  process.exitCode = 1;
});
