import type { IncomingMessage, ServerResponse } from 'node:http';
import { DEMO_AS_OF, listDemoQueue } from './console-demo-data.js';
import { prepareDemoReminder } from './console-demo-proposals.js';
import type { ProposalStore } from './proposals.js';

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
  return true;
}

// Fictional fixtures only. Mount after the local Host and Origin checks.
export async function handleDemoConsoleApi(
  request: IncomingMessage, response: ServerResponse, url: URL,
  store?: Pick<ProposalStore, 'createReminder'>,
): Promise<boolean> {
  if (url.pathname === '/api/demo/execute') {
    return json(response, 403, {
      error: 'Execution is disabled in the demo console',
      approvalRecorded: false, executed: false,
    });
  }
  if (url.pathname === '/api/demo/proposals') {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      return json(response, 405, { error: 'Method not allowed' });
    }
    if (!store) {
      return json(response, 503, { error: 'Demo proposal storage is unavailable' });
    }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      return json(response, 415, { error: 'JSON content is required' });
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
      } else if (!oversized) chunks.push(buffer);
    }
    if (oversized) {
      return json(response, 413, { error: 'Request body is too large' });
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
      return json(response, 400, {
        error: 'Provide only the selected simulated invoice itemId',
      });
    }
    return json(response, 200, prepareDemoReminder(store, itemId));
  }
  if (url.pathname !== '/api/demo/queue') return false;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return json(response, 405, { error: 'Method not allowed' });
  }
  const type = url.searchParams.get('type');
  const deadline = url.searchParams.get('deadline') ?? 'all';
  const invalidQuery = [...url.searchParams.keys()].some(key =>
    !['type', 'deadline'].includes(key) || url.searchParams.getAll(key).length !== 1,
  );
  if (invalidQuery ||
      (type !== null && type !== 'dispute' && type !== 'invoice') ||
      (deadline !== 'all' && deadline !== 'overdue' && deadline !== 'next24h')) {
    return json(response, 400, { error: 'Invalid queue filters' });
  }
  if (request.method === 'HEAD') {
    response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    response.end();
    return true;
  }
  return json(response, 200, {
    simulated: true, asOf: DEMO_AS_OF,
    items: listDemoQueue({ type: type ?? undefined, deadline }),
  });
}
