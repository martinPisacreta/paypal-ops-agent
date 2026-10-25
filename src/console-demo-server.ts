import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { DEMO_AS_OF, listDemoQueue } from './console-demo-data.js';
import { consoleDemoPage } from './console-demo-page.js';
import { prepareDemoReminder } from './console-demo-proposals.js';
import type { ProposalStore } from './proposals.js';

export interface DemoConsoleOptions {
  proposalStore?: Pick<ProposalStore, 'createReminder'>;
}

const gridAsset = fileURLToPath(new URL(
  '../node_modules/ag-grid-community/dist/ag-grid-community.min.js',
  import.meta.url,
));

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export function createDemoConsoleServer(options: DemoConsoleOptions = {}) {
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');

    void (async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        json(response, 503, { error: 'Console is unavailable' });
        return;
      }
      const allowedHosts = [
        `127.0.0.1:${address.port}`,
        `localhost:${address.port}`,
      ];
      const host = request.headers.host;
      if (!host || !allowedHosts.includes(host)) {
        json(response, 403, { error: 'A local console address is required' });
        return;
      }
      const origin = request.headers.origin;
      if (origin && !allowedHosts.some(value => origin === `http://${value}`)) {
        json(response, 403, { error: 'Cross-origin requests are disabled' });
        return;
      }
      const target = request.url || '/';
      if (!target.startsWith('/') || target.startsWith('//')) {
        json(response, 400, { error: 'Invalid request target' });
        return;
      }
      const url = new URL(target, `http://${host}`);
      if (url.host !== host) {
        json(response, 400, { error: 'Invalid request target' });
        return;
      }

      // The demo cannot issue approvals or invoke the PayPal sender.
      // Genuine execution remains behind the existing approval-controlled MCP tool.
      if (url.pathname === '/api/demo/execute') {
        json(response, 403, {
          error: 'Execution is disabled in the demo console',
          approvalRecorded: false,
          executed: false,
        });
        return;
      }
      if (url.pathname === '/api/demo/proposals') {
        if (request.method !== 'POST') {
          response.setHeader('Allow', 'POST');
          json(response, 405, { error: 'Method not allowed' });
          return;
        }
        if (!options.proposalStore) {
          json(response, 503, { error: 'Demo proposal storage is unavailable' });
          return;
        }
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
          json(response, 415, { error: 'JSON content is required' });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        let oversized = false;
        for await (const chunk of request) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += buffer.length;
          if (size > 4096) {
            oversized = true;
            chunks.length = 0;
          } else if (!oversized) {
            chunks.push(buffer);
          }
        }
        if (oversized) {
          json(response, 413, { error: 'Request body is too large' });
          return;
        }
        let itemId: string;
        try {
          const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!body || typeof body !== 'object' || Array.isArray(body)) {
            throw new Error('Invalid body');
          }
          const record = body as Record<string, unknown>;
          if (Object.keys(record).length !== 1 || typeof record.itemId !== 'string') {
            throw new Error('Invalid fields');
          }
          itemId = record.itemId;
          if (!listDemoQueue().some(item => item.id === itemId && item.type === 'invoice')) {
            throw new Error('Invalid invoice');
          }
        } catch {
          json(response, 400, { error: 'Provide only the selected simulated invoice itemId' });
          return;
        }
        const result = prepareDemoReminder(options.proposalStore, itemId);
        json(response, 200, result);
        return;
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (url.pathname === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(request.method === 'HEAD' ? undefined : consoleDemoPage);
        return;
      }
      if (url.pathname === '/vendor/ag-grid-community.min.js') {
        try {
          const asset = await readFile(gridAsset);
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          response.end(request.method === 'HEAD' ? undefined : asset);
        } catch {
          json(response, 503, { error: 'Install the local ag-grid-community dependency' });
        }
        return;
      }
      if (url.pathname === '/api/demo/queue') {
        const type = url.searchParams.get('type');
        const deadline = url.searchParams.get('deadline') ?? 'all';
        const invalidQuery = [...url.searchParams.keys()].some(key =>
          !['type', 'deadline'].includes(key) || url.searchParams.getAll(key).length !== 1,
        );
        if (invalidQuery ||
            (type !== null && type !== 'dispute' && type !== 'invoice') ||
            (deadline !== 'all' && deadline !== 'overdue' && deadline !== 'next24h')) {
          json(response, 400, { error: 'Invalid queue filters' });
          return;
        }
        const body = {
          simulated: true,
          asOf: DEMO_AS_OF,
          items: listDemoQueue({ type: type ?? undefined, deadline }),
        };
        if (request.method === 'HEAD') {
          response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          response.end();
        } else {
          json(response, 200, body);
        }
        return;
      }
      json(response, 404, { error: 'Not found' });
    })().catch(() => {
      if (!response.headersSent) {
        json(response, 500, { error: 'Console request failed' });
      } else {
        response.end();
      }
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

export async function startDemoConsole(port = 8790, options: DemoConsoleOptions = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('Invalid demo console port');
  }
  const server = createDemoConsoleServer(options);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  return server;
}
