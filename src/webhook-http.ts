import { createServer } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import { WebhookError, WebhookInbox } from './webhooks.ts';
import type { SignatureVerifier, WebhookHeaders } from './webhooks.ts';

const MAX_BODY_BYTES = 1_048_576;

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let finished = false;
    const fail = (error: Error): void => {
      if (finished) return;
      finished = true;
      chunks.length = 0;
      reject(error);
    };
    request.on('data', (chunk: Buffer) => {
      if (finished) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        fail(new WebhookError(413, 'Webhook body exceeds the size limit'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('aborted', () => fail(new WebhookError(400, 'Interrupted request')));
    request.on('error', () => fail(new WebhookError(400, 'Request read failed')));
    request.on('end', () => {
      if (finished) return;
      try {
        const body = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        finished = true;
        resolve(body);
      } catch {
        fail(new WebhookError(400, 'Invalid UTF-8 body'));
      }
    });
  });
}

// Construction does not bind a port. The caller supplies the real verifier.
// No permissive default verifier or signature bypass is provided.
export function createWebhookServer(
  inbox: WebhookInbox,
  verifySignature: SignatureVerifier,
): Server {
  if (typeof verifySignature !== 'function') {
    throw new Error('A signature verifier is required');
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (request.url !== '/webhooks/paypal') {
        throw new WebhookError(404, 'Route not found');
      }
      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST');
        throw new WebhookError(405, 'POST required');
      }
      const mediaType = request.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
      if (mediaType !== 'application/json') {
        throw new WebhookError(415, 'application/json required');
      }
      const encoding = request.headers['content-encoding'];
      if (encoding !== undefined && encoding.toLowerCase() !== 'identity') {
        throw new WebhookError(415, 'Encoded request bodies are unsupported');
      }
      const headers: Record<string, string> = {};
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]?.toLowerCase();
        const value = request.rawHeaders[index + 1];
        if (!name?.startsWith('paypal-') || value === undefined) continue;
        if (Object.hasOwn(headers, name)) {
          throw new WebhookError(400, 'Duplicate PayPal header');
        }
        headers[name] = value;
      }
      const body = await readBody(request);
      const result = await inbox.receive(body, headers satisfies WebhookHeaders, verifySignature);
      response.statusCode = 200;
      response.end(JSON.stringify(result));
    } catch (error) {
      request.resume();
      response.statusCode = error instanceof WebhookError ? error.status : 503;
      response.end(JSON.stringify({
        error: error instanceof WebhookError ? error.message : 'Webhook processing unavailable',
      }));
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;
  return server;
}
