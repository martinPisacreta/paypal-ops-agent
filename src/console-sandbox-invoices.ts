export interface ConsoleSandboxInvoice {
  id: string;
  status: string;
  amount: { value: string; currency: string } | null;
  deadline: string | null;
  deadlineConvention: string | null;
  previousReminders: null;
  openDispute: null;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function outstanding(value: unknown): ConsoleSandboxInvoice['amount'] {
  const amount = record(value);
  if (typeof amount.value !== 'string' ||
      !/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(amount.value) ||
      typeof amount.currency_code !== 'string' ||
      !/^[A-Z]{3}$/.test(amount.currency_code)) return null;
  const [whole, fraction = ''] = amount.value.split('.');
  if (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0')) <= 0n) {
    return null;
  }
  return { value: amount.value, currency: amount.currency_code };
}

function dueDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const timestamp = value + 'T00:00:00.000Z';
  const parsed = new Date(timestamp);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === timestamp
    ? timestamp : null;
}

// Explicit projection: never return customer fields, links or raw API objects.
export function sandboxInvoiceQueue(input: unknown, asOf: string) {
  const source = record(input);
  if (!Array.isArray(source.items) || source.items.length > 100 ||
      !Number.isFinite(Date.parse(asOf))) {
    throw new Error('Invalid sandbox invoice snapshot');
  }
  const seen = new Set<string>();
  const items: ConsoleSandboxInvoice[] = source.items.map(value => {
    const invoice = record(value);
    if (typeof invoice.id !== 'string' ||
        !/^INV2-[A-Z0-9-]{1,250}$/.test(invoice.id) ||
        typeof invoice.status !== 'string' ||
        !['SENT', 'UNPAID', 'PARTIALLY_PAID'].includes(invoice.status) ||
        seen.has(invoice.id)) {
      throw new Error('Invalid sandbox invoice snapshot');
    }
    seen.add(invoice.id);
    const detail = record(invoice.detail);
    const deadline = dueDate(record(detail.payment_term).due_date);
    return {
      id: invoice.id,
      status: invoice.status,
      amount: outstanding(invoice.due_amount),
      deadline,
      deadlineConvention: deadline === null ? null
        : 'Calendar due date normalized to midnight UTC; actual due time is unknown.',
      previousReminders: null,
      openDispute: null,
    };
  });
  return {
    mode: 'sandbox' as const,
    readOnly: true,
    asOf,
    items,
    pagination: {
      scope: 'single_page',
      hasMore: record(source.pagination).hasMore === true,
    },
    limitations: [
      'Only the fetched invoice page is shown; this may be an incomplete queue.',
      'Missing outstanding amounts and deadlines remain unknown.',
      'Previous reminder counts and dispute status are not verified by this read.',
      'Approval requires the terminal; execution requires MCP.',
    ],
  };
}
