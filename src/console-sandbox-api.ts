import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';
import { sandboxInvoiceQueue } from './console-sandbox-invoices.js';
import { sandboxInvoicePriority } from './console-sandbox-priority.js';

type Queue = ReturnType<typeof sandboxInvoiceQueue>;
export interface SandboxConsoleReads {
  readInvoices: (limit: number) => Promise<unknown>;
  // These adapters must project public fields and redact free-text content.
  listProposals: () => unknown;
  getHistory: (proposalId: string) => unknown;
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

function query(url: URL, fields: string[]): boolean {
  return [...url.searchParams.keys()].every(key =>
    fields.includes(key) && url.searchParams.getAll(key).length === 1,
  ) && fields.every(key => Boolean(url.searchParams.get(key)));
}

// Mount after the existing loopback Host and Origin checks.
// No approval, proposal creation or execution operation is accepted here.
export function createSandboxConsoleApi(reads?: SandboxConsoleReads) {
  let snapshot: { id: string; queue: Queue } | undefined;
  let refreshGeneration = 0;
  return async (url: URL, method: string | undefined, response: ServerResponse) => {
    if (!url.pathname.startsWith('/api/sandbox/')) return false;
    if (method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(response, 405, { error: 'Sandbox console routes are read-only' });
      return true;
    }
    const routes = ['/api/sandbox/queue', '/api/sandbox/priority',
      '/api/sandbox/proposals', '/api/sandbox/history'];
    if (!routes.includes(url.pathname)) {
      json(response, 404, { error: 'Not found' });
      return true;
    }
    if (!reads) {
      json(response, 503, { error: 'Sandbox reading is not configured' });
      return true;
    }
    try {
      if (url.pathname === '/api/sandbox/queue') {
        if (!query(url, [])) {
          json(response, 400, { error: 'Queue takes no query parameters' });
          return true;
        }
        const generation = ++refreshGeneration;
        const raw = await reads.readInvoices(100);
        const queue = sandboxInvoiceQueue(raw, new Date().toISOString());
        if (generation !== refreshGeneration) {
          json(response, 409, { error: 'A newer queue refresh superseded this request' });
          return true;
        }
        snapshot = { id: randomUUID(), queue };
        json(response, 200, { ...queue, snapshotId: snapshot.id });
      } else if (url.pathname === '/api/sandbox/priority') {
        if (!query(url, ['invoiceId', 'snapshotId'])) {
          json(response, 400, { error: 'Provide invoiceId and snapshotId only' });
        } else if (!snapshot || url.searchParams.get('snapshotId') !== snapshot.id) {
          json(response, 409, { error: 'Refresh the queue before selecting an invoice' });
        } else if (!snapshot.queue.items.some(item =>
          item.id === url.searchParams.get('invoiceId'))) {
          json(response, 400, { error: 'Select an invoice from the displayed snapshot' });
        } else {
          json(response, 200, {
            ...sandboxInvoicePriority(snapshot.queue.items,
              url.searchParams.get('invoiceId')!, snapshot.queue.asOf),
            snapshotId: snapshot.id,
          });
        }
      } else if (url.pathname === '/api/sandbox/proposals') {
        if (!query(url, [])) {
          json(response, 400, { error: 'Proposal listing takes no query parameters' });
        } else {
          json(response, 200, { mode: 'sandbox', readOnly: true,
            proposals: await reads.listProposals() });
        }
      } else {
        const id = url.searchParams.get('proposalId');
        if (!query(url, ['proposalId']) || !id ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
          json(response, 400, { error: 'Provide one valid proposalId' });
        } else {
          json(response, 200, { mode: 'sandbox', readOnly: true,
            history: await reads.getHistory(id) });
        }
      }
    } catch {
      if (!response.headersSent) {
        json(response, 503, { error: 'Sandbox read unavailable; no action was executed' });
      } else response.end();
    }
    return true;
  };
}
