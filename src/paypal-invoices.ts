import type { SandboxPayPalHttp } from './paypal-http.ts';

type Transport = Pick<SandboxPayPalHttp, 'request'>;
const UNPAID_STATUSES = new Set(['SENT', 'UNPAID', 'PARTIALLY_PAID']);

export function createSandboxUnpaidInvoiceReader(http: Transport) {
  return async (limit: number): Promise<unknown> => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }
    const response = await http.request(
      'GET', '/v2/invoicing/invoices', undefined,
      { page: 1, page_size: limit },
    );
    const body = response.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('Invalid PayPal sandbox invoices response');
    }
    const record = body as Record<string, unknown>;
    if (!Array.isArray(record.items) || record.items.length > limit ||
        record.items.some(item => typeof item !== 'object' || item === null ||
          Array.isArray(item) || typeof item.id !== 'string' ||
          !item.id.trim() || typeof item.status !== 'string' ||
          !item.status.trim())) {
      throw new Error('Invalid PayPal sandbox invoices response');
    }
    if (record.links !== undefined && (!Array.isArray(record.links) ||
        record.links.some(link => typeof link !== 'object' || link === null ||
          Array.isArray(link) || typeof link.rel !== 'string'))) {
      throw new Error('Invalid PayPal sandbox invoices pagination');
    }
    const invoices = record.items as Array<Record<string, unknown>>;
    const items = invoices.filter(invoice =>
      UNPAID_STATUSES.has(invoice.status as string));
    const links = (record.links ?? []) as Array<{ rel: string }>;
    return {
      items,
      requestedLimit: limit,
      scannedCount: invoices.length,
      returnedCount: items.length,
      includedStatuses: [...UNPAID_STATUSES],
      pagination: {
        scope: 'single_page',
        filteredLocally: true,
        hasMore: links.some(link => link.rel === 'next'),
      },
    };
  };
}
