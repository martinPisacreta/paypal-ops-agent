import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';

const envPath = fileURLToPath(new URL('../.env', import.meta.url));
const base = 'https://api-m.sandbox.paypal.com';
// Public HTTPS URL that forwards to the receiver's /webhooks/paypal route.
const url = process.env.PAYPAL_WEBHOOK_URL ?? '';
const names = [
  'INVOICING.INVOICE.CREATED',
  'INVOICING.INVOICE.PAID',
  'INVOICING.INVOICE.CANCELLED',
  'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED',
  'CUSTOMER.DISPUTE.RESOLVED',
];

async function main() {
  if (!url.startsWith('https://') || url.includes(' ')) throw new Error('Set PAYPAL_WEBHOOK_URL to the public HTTPS URL');
  const original = readFileSync(envPath, 'utf8');
  const env = parseEnv(original);
  if ((env.PAYPAL_ENVIRONMENT ?? 'sandbox') !== 'sandbox' ||
      !env.PAYPAL_CLIENT_ID?.trim() || !env.PAYPAL_CLIENT_SECRET?.trim()) {
    throw new Error('Invalid sandbox configuration');
  }
  const auth = await fetch(base + '/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(30000),
  });
  if (!auth.ok) throw new Error('Authentication failed');
  const token = (await auth.json()).access_token;
  if (typeof token !== 'string' || !token) throw new Error('Missing access token');

  async function request(path, options = {}) {
    return fetch(base + path, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
  }

  const response = await request('/v1/notifications/webhooks', {
    method: 'POST',
    body: JSON.stringify({ url, event_types: names.map(name => ({ name })) }),
  });
  const result = await response.json();
  let webhook;
  let reused = false;
  if (response.ok) {
    webhook = result;
  } else {
    const duplicateCodes = new Set(['WEBHOOK_URL_ALREADY_EXISTS', 'WEBHOOK_ALREADY_EXISTS']);
    const duplicate = duplicateCodes.has(result.name) ||
      (Array.isArray(result.details) && result.details.some(detail => duplicateCodes.has(detail.issue)));
    if (![400, 409, 422].includes(response.status) || !duplicate) {
      throw new Error('Webhook registration rejected');
    }
    const listed = await request('/v1/notifications/webhooks');
    if (!listed.ok) throw new Error('Webhook lookup failed');
    const body = await listed.json();
    if (!Array.isArray(body.webhooks)) throw new Error('Invalid webhook list');
    const matches = body.webhooks.filter(item => item.url === url);
    if (matches.length !== 1) throw new Error('Webhook URL requires reconciliation');
    webhook = matches[0];
    reused = true;
  }
  if (typeof webhook?.id !== 'string' || !/^[A-Za-z0-9-]+$/.test(webhook.id)) {
    throw new Error('Invalid webhook ID');
  }

  // Confirm the registered URL and subscriptions before changing local configuration.
  const confirmed = await request('/v1/notifications/webhooks/' + encodeURIComponent(webhook.id));
  if (!confirmed.ok) throw new Error('Registration confirmation failed');
  const registered = await confirmed.json();
  const subscriptions = new Set((registered.event_types ?? []).map(item => item.name));
  if (registered.id !== webhook.id || registered.url !== url ||
      (!subscriptions.has('*') && names.some(name => !subscriptions.has(name)))) {
    throw new Error('Registered webhook does not cover the requested events');
  }

  const lines = original.split(/\r?\n/).filter(line =>
    !/^\s*(?:export\s+)?PAYPAL_WEBHOOK_ID\s*=/.test(line));
  while (lines.at(-1) === '') lines.pop();
  const updated = lines.join('\n') + '\nPAYPAL_WEBHOOK_ID=' + webhook.id + '\n';
  const temporary = envPath + '.tmp-' + randomUUID();
  try {
    writeFileSync(temporary, updated, { flag: 'wx', mode: 0o600 });
    if (readFileSync(envPath, 'utf8') !== original) throw new Error('Concurrent configuration change');
    renameSync(temporary, envPath);
  } finally {
    try { unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  console.log('Sandbox webhook registered' + (reused ? ' (existing registration reused)' : '') + '; subscriptions confirmed and PAYPAL_WEBHOOK_ID saved to .env. Restart the receiver to enable verification.');
}

main().catch(() => {
  console.error('Registration did not finish cleanly. Remote registration or local configuration may already exist; reconcile before retrying. No credentials or webhook ID printed.');
  process.exitCode = 1;
});
