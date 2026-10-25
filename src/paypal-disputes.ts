import type { SandboxPayPalHttp } from './paypal-http.ts';

type Transport = Pick<SandboxPayPalHttp, 'request'>;

export function createSandboxDisputeReader(http: Transport) {
  return async (limit: number): Promise<unknown> => {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('limit must be an integer between 1 and 100');
    }
    // Read one bounded page. Never follow a response-supplied URL.
    const pageSize = Math.min(limit, 50);
    const response = await http.request(
      'GET', '/v1/customer/disputes', undefined, { page_size: pageSize },
    );
    const body = response.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new Error('Invalid PayPal sandbox disputes response');
    }
    const record = body as Record<string, unknown>;
    if (!Array.isArray(record.items) || record.items.length > pageSize ||
        record.items.some(item => typeof item !== 'object' || item === null ||
          Array.isArray(item) || typeof item.dispute_id !== 'string' ||
          !item.dispute_id.trim())) {
      throw new Error('Invalid PayPal sandbox disputes response');
    }
    if (record.links !== undefined && (!Array.isArray(record.links) ||
        record.links.some(link => typeof link !== 'object' || link === null ||
          Array.isArray(link) || typeof link.rel !== 'string'))) {
      throw new Error('Invalid PayPal sandbox disputes pagination');
    }
    const links = (record.links ?? []) as Array<{ rel: string }>;
    return {
      items: record.items,
      requestedLimit: limit,
      returnedCount: record.items.length,
      pagination: {
        scope: 'single_page',
        hasMore: links.some(link => link.rel === 'next'),
      },
    };
  };
}
