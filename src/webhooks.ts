import { DatabaseSync } from 'node:sqlite';

export type WebhookEvent = {
  id: string;
  event_type: string;
  resource: Record<string, unknown>;
  [key: string]: unknown;
};

// The HTTP adapter must provide lowercase header names.
export type WebhookHeaders = Readonly<Record<string, string | undefined>>;

// The PayPal adapter must call official signature verification and return true
// only for SUCCESS. Missing configuration and verification errors must reject.
export type SignatureVerifier = (
  headers: WebhookHeaders,
  event: WebhookEvent,
) => Promise<boolean>;

export class WebhookError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'WebhookError';
    this.status = status;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEvent(rawBody: string): WebhookEvent {
  if (Buffer.byteLength(rawBody, 'utf8') > 1_048_576) {
    throw new WebhookError(413, 'Webhook body exceeds the size limit');
  }
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new WebhookError(400, 'Invalid webhook JSON');
  }
  if (!isObject(value) ||
      typeof value.id !== 'string' || !value.id.trim() ||
      value.id.length > 255 ||
      typeof value.event_type !== 'string' || !value.event_type.trim() ||
      value.event_type.length > 255 || !isObject(value.resource)) {
    throw new WebhookError(400, 'Invalid webhook event');
  }
  return value as WebhookEvent;
}

export class WebhookInbox {
  private readonly database: DatabaseSync;

  constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS paypal_webhook_inbox (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        received_at TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'pending'
          CHECK (state IN ('pending', 'processed'))
      );
    `);
  }

  async receive(
    rawBody: string,
    headers: WebhookHeaders,
    verifySignature: SignatureVerifier,
  ): Promise<{ status: 'queued' | 'duplicate'; eventId: string }> {
    const event = parseEvent(rawBody);
    const required = [
      'paypal-auth-algo',
      'paypal-cert-url',
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time',
    ];
    for (const name of required) {
      const value = headers[name];
      if (typeof value !== 'string' || !value.trim()) {
        throw new WebhookError(401, 'Missing signature verification headers');
      }
    }

    // Verify even redeliveries. An exception leaves the database untouched.
    if (await verifySignature(headers, event) !== true) {
      throw new WebhookError(401, 'Webhook signature verification failed');
    }

    // One atomic insert arbitrates concurrent deliveries, including separate
    // processes. The persistent primary key also survives service restarts.
    const result = this.database.prepare(`
      INSERT INTO paypal_webhook_inbox
        (event_id, event_type, payload_json, received_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(event_id) DO NOTHING
    `).run(event.id, event.event_type, rawBody, new Date().toISOString());

    // This is durable intake only: no reminder, refund or other action runs.
    return {
      status: Number(result.changes) === 1 ? 'queued' : 'duplicate',
      eventId: event.id,
    };
  }

  close(): void {
    this.database.close();
  }
}
