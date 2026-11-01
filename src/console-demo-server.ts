import { createServer, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { consoleDemoPage } from './console-demo-page.js';
import { handleDemoConsoleApi } from './console-demo-api.js';
import { consoleSandboxPage } from './console-sandbox-page.js';
import { createSandboxConsoleApi, type SandboxConsoleReads } from './console-sandbox-api.js';
import type { ProposalStore } from './proposals.js';

export interface DemoConsoleOptions {
  proposalStore?: Pick<ProposalStore, 'createReminder'>;
  sandboxReads?: SandboxConsoleReads;
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
  const sandboxApi = createSandboxConsoleApi(options.sandboxReads);
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
        `127.0.0.1:${address.port}`, `localhost:${address.port}`,
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
      if (await sandboxApi(url, request.method, response)) return;
      if (await handleDemoConsoleApi(request, response, url, options.proposalStore)) return;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.setHeader('Allow', 'GET, HEAD');
        json(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (url.pathname === '/' || url.pathname === '/sandbox') {
        const page = url.pathname === '/' ? consoleDemoPage : consoleSandboxPage;
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(request.method === 'HEAD' ? undefined : page);
        return;
      }
      if (url.pathname === '/vendor/ag-grid-community.min.js') {
        try {
          const asset = await readFile(gridAsset);
          response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
          response.end(request.method === 'HEAD' ? undefined : asset);
        } catch {
          json(response, 503, { error: 'The local grid asset is unavailable' });
        }
        return;
      }
      json(response, 404, { error: 'Not found' });
    })().catch(() => {
      if (!response.headersSent) {
        json(response, 500, { error: 'Console request failed' });
      } else response.end();
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
