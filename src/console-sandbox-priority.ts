import { explainInvoicePriority } from './priorities.js';
import type { ConsoleSandboxInvoice } from './console-sandbox-invoices.js';

// Advisory comparison only. Unknown context must never become a factual claim.
export function sandboxInvoicePriority(
  items: readonly ConsoleSandboxInvoice[],
  invoiceId: string,
  asOf: string,
) {
  const selected = items.find(item => item.id === invoiceId);
  if (!selected) throw new Error('Select an invoice from the current snapshot');
  const limitations = [
    'Previous reminder counts and open disputes are unknown.',
    'The comparison assumes zero previous reminders and no open disputes for every included invoice. These are hypothetical inputs, not verified facts.',
    'Only invoices with a known outstanding amount in the selected currency are compared.',
    'Calendar due dates use midnight UTC; actual due times are unknown.',
    'This explanation uses the fetched page, not the complete account queue.',
    'Manual review is required before considering customer contact.',
  ];
  const base = {
    mode: 'sandbox' as const,
    readOnly: true,
    invoiceId,
    asOf,
    manualReviewRequired: true,
    limitations,
    effects: { persisted: false, approved: false, executed: false },
  };
  if (selected.amount === null) {
    return {
      ...base,
      available: false,
      explanation: null,
      reason: 'Outstanding amount is unavailable; a priority comparison cannot be calculated.',
    };
  }
  const comparable = items.filter(item =>
    item.amount !== null &&
    item.amount.currency === selected.amount!.currency,
  );
  const explanation = explainInvoicePriority({
    invoiceId,
    now: asOf,
    invoices: comparable.map(item => ({
      id: item.id,
      deadline: item.deadline,
      amount: item.amount!,
      previousReminders: 0,
      openDispute: false,
    })),
  });
  return {
    ...base,
    available: true,
    comparisonKind: 'Hypothetical baseline with unverified reminder and dispute context',
    comparedCount: comparable.length,
    excludedCount: items.length - comparable.length,
    explanation,
  };
}
