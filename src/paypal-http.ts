import type { Configuration } from './config.ts';

const SANDBOX_ORIGIN = 'https://api-m.sandbox.paypal.com';
type Fetch = typeof globalThis.fetch;

// Sandbox only. Errors exclude credentials and response bodies.
// Requests are attempted once; ambiguous outcomes require reconciliation.
export class SandboxPayPalHttp {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private token: { value: string; validUntil: number } | undefined;
  private pendingToken: Promise<string> | undefined;
  private readonly fetcher: Fetch;

  constructor(configuration: Configuration, fetcher: Fetch = globalThis.fetch) {
    this.fetcher = fetcher;
    if (configuration.environment !== 'sandbox') {
      throw new Error('Only PayPal sandbox is supported');
    }
    for (const value of [configuration.clientId, configuration.clientSecret]) {
      if (typeof value !== 'string' || !value.trim() || /[\r\n\0]/.test(value)) {
        throw new Error('Invalid PayPal sandbox credentials');
      }
    }
    this.clientId = configuration.clientId;
    this.clientSecret = configuration.clientSecret;
  }

  private async fetchOnce(
    path: string, initialization: RequestInit,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(SANDBOX_ORIGIN + path, {
        ...initialization,
        redirect: 'error',
        signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error('PayPal sandbox rejected the request');
      }
      if (response.status === 204) return { status: 204, body: null };
      const body: unknown = await response.json();
      return { status: response.status, body };
    } catch {
      throw new Error('PayPal sandbox request failed; remote outcome may be unknown');
    } finally {
      clearTimeout(timer);
    }
  }

  private async acquireToken(): Promise<string> {
    const requestedAt = Date.now();
    const credentials = Buffer.from(
      this.clientId + ':' + this.clientSecret, 'utf8',
    ).toString('base64');
    const response = await this.fetchOnce('/v1/oauth2/token', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + credentials,
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const body = response.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('Invalid PayPal sandbox authentication response');
    }
    const record = body as Record<string, unknown>;
    if (typeof record.access_token !== 'string' || !record.access_token ||
        /[\s\0]/.test(record.access_token) ||
        typeof record.token_type !== 'string' ||
        record.token_type.toLowerCase() !== 'bearer' ||
        typeof record.expires_in !== 'number' ||
        !Number.isFinite(record.expires_in) || record.expires_in <= 0) {
      throw new Error('Invalid PayPal sandbox authentication response');
    }
    this.token = {
      value: record.access_token,
      validUntil: requestedAt + Math.max(0, record.expires_in - 60) * 1000,
    };
    return record.access_token;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.validUntil > Date.now()) {
      return this.token.value;
    }
    if (!this.pendingToken) {
      this.pendingToken = this.acquireToken().finally(() => {
        this.pendingToken = undefined;
      });
    }
    return this.pendingToken;
  }

  async request(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | boolean>,
  ): Promise<{ status: number; body: unknown }> {
    // Literal API paths preserve the fixed sandbox origin. Query values
    // are supplied separately and encoded before authentication.
    if ((method !== 'GET' && method !== 'POST') ||
        typeof path !== 'string' ||
        !/^\/v[12]\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path) ||
        path === '/v1/oauth2/token' ||
        (method === 'GET' && body !== undefined)) {
      throw new Error('Invalid PayPal sandbox request');
    }
    const parameters = new URLSearchParams();
    if (query !== undefined) {
      if (typeof query !== 'object' || query === null || Array.isArray(query)) {
        throw new Error('Invalid PayPal sandbox query');
      }
      const entries = Object.entries(query);
      if (entries.length > 20) throw new Error('Invalid PayPal sandbox query');
      for (const [key, value] of entries) {
        if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
            !['string', 'number', 'boolean'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isFinite(value))) {
          throw new Error('Invalid PayPal sandbox query');
        }
        const text = String(value);
        if (text.length > 2048 || /[\r\n\0]/.test(text)) {
          throw new Error('Invalid PayPal sandbox query');
        }
        parameters.append(key, text);
      }
    }
    const encodedQuery = parameters.toString();
    const requestPath = path + (encodedQuery ? '?' + encodedQuery : '');
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    const token = await this.accessToken();
    return this.fetchOnce(requestPath, {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/json',
        ...(serialized === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(serialized === undefined ? {} : { body: serialized }),
    });
  }
}
