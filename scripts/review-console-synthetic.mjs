import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { consoleSandboxPage } from '../dist/console-sandbox-page.js';
import { createSandboxConsoleApi } from '../dist/console-sandbox-api.js';

// Run after building: node scripts/review-console-synthetic.mjs populated
// Other scenarios: empty, error. No credentials, SQLite or PayPal adapters.
const scenario = process.argv[2] ?? 'populated';
if (!['populated', 'empty', 'error'].includes(scenario)) {
  throw new Error('Choose populated, empty or error');
}
const proposalId = '11111111-1111-4111-8111-111111111111';
const invoiceId = 'INV2-TEST-001';
const api = createSandboxConsoleApi({
  readInvoices: async () => {
    if (scenario === 'error') throw new Error('Synthetic read failure');
    return { items: scenario === 'empty' ? [] : [{
      id: invoiceId, status: 'UNPAID',
      due_amount: { value: '10.00', currency_code: 'USD' },
      detail: { payment_term: { due_date: '2026-10-27' } },
    }], pagination: { hasMore: false } };
  },
  listProposals: () => {
    if (scenario === 'error') throw new Error('Synthetic read failure');
    return { items: scenario === 'empty' ? [] : [{ proposalId, invoiceId }],
      hasMore: false };
  },
  getHistory: id => {
    if (scenario !== 'populated' || id !== proposalId) {
      return { proposalId: id, found: false, timeline: [] };
    }
    return { proposalId: id, found: true, synthetic: true,
      note: 'Illustrative display fixture; not a store-contract validation.',
      recipientDeliveryVerified: false,
      timeline: [
        { event: 'proposal', at: '2026-10-28T12:00:00Z' },
        { event: 'approval', at: '2026-10-28T12:01:00Z' },
        { event: 'attempt', at: '2026-10-28T12:02:00Z' },
        { event: 'result', at: '2026-10-28T12:02:01Z',
          outcome: 'uncertain', recipientDeliveryVerified: false },
      ] };
  },
});
const page = consoleSandboxPage
  .replace('<title>Sandbox invoice review</title>', '<title>SYNTHETIC console review</title>')
  .replace('<h1>Sandbox invoice review</h1>',
    '<h1>SYNTHETIC console review: ' + scenario + '</h1>')
  .replace('<p class="notice">',
    '<p class="notice">FICTIONAL FIXTURES ONLY. No PayPal connection. ');
const asset = new URL('../node_modules/ag-grid-community/dist/ag-grid-community.min.js', import.meta.url);
function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'no-referrer');
  void (async () => {
    const host = '127.0.0.1:' + server.address().port;
    if (request.headers.host !== host ||
        (request.headers.origin && request.headers.origin !== 'http://' + host)) {
      return json(response, 403, { error: 'Loopback origin required' });
    }
    const target = request.url ?? '/';
    if (!target.startsWith('/') || target.startsWith('//')) {
      return json(response, 400, { error: 'Invalid target' });
    }
    const url = new URL(target, 'http://' + host);
    if (await api(url, request.method, response)) return;
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD');
      return json(response, 405, { error: 'Read only' });
    }
    if (url.pathname === '/' || url.pathname === '/sandbox') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return response.end(request.method === 'HEAD' ? undefined : page);
    }
    if (url.pathname === '/vendor/ag-grid-community.min.js') {
      const bytes = await readFile(asset);
      response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8' });
      return response.end(request.method === 'HEAD' ? undefined : bytes);
    }
    json(response, 404, { error: 'Not found' });
  })().catch(() => {
    if (!response.headersSent) json(response, 503, { error: 'Synthetic harness unavailable' });
    else response.end();
  });
});
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(0, '127.0.0.1', () => {
  console.log('SYNTHETIC ' + scenario + ': http://127.0.0.1:' + server.address().port + '/sandbox');
  console.log('No visual validation claimed. Stop with Ctrl+C.');
});
