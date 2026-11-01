export type OperationItem = {
  id: string;
  kind: 'dispute' | 'unpaid_invoice';
  deadline: string | null;
};

export type PrioritizedItem = OperationItem & {
  priority: 'overdue' | 'urgent' | 'upcoming' | 'normal' | 'needs_review';
  reason: string;
};

const DAY_MS = 86_400_000;
const rank: Record<PrioritizedItem['priority'], number> = {
  overdue: 0,
  needs_review: 1,
  urgent: 2,
  upcoming: 3,
  normal: 4,
};

// Supply the clock explicitly so classification is reproducible in tests.
// Inputs represent open disputes and unpaid invoices normalized by the adapter.
// Classification never approves or executes an action.
export function prioritize(
  items: readonly OperationItem[],
  now: Date,
): PrioritizedItem[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new Error('Invalid classification clock');

  const seen = new Set<string>();
  const result = items.map((item): PrioritizedItem => {
    if (typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('An item ID is required');
    }
    if (item.kind !== 'dispute' && item.kind !== 'unpaid_invoice') {
      throw new Error('Unsupported item kind');
    }
    const key = JSON.stringify([item.kind, item.id]);
    if (seen.has(key)) throw new Error('Duplicate operation item');
    seen.add(key);

    if (item.deadline === null) {
      return { ...item, priority: 'needs_review', reason: 'No deadline available; review manually.' };
    }
    if (typeof item.deadline !== 'string') {
      throw new Error('Deadline must be a timestamp or null');
    }
    // Require a timezone to avoid depending on the server local timezone.
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(item.deadline);
    const deadlineMs = Date.parse(item.deadline);
    if (!match || !Number.isFinite(deadlineMs)) {
      throw new Error('Deadline must be an ISO timestamp with a timezone');
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hour = Number(match[4]);
    const minute = Number(match[5]);
    const second = Number(match[6]);
    const calendar = new Date(0);
    calendar.setUTCFullYear(year, month - 1, day);
    calendar.setUTCHours(0, 0, 0, 0);
    if (calendar.getUTCFullYear() !== year ||
        calendar.getUTCMonth() !== month - 1 ||
        calendar.getUTCDate() !== day ||
        hour > 23 || minute > 59 || second > 59) {
      throw new Error('Deadline contains an invalid calendar date or time');
    }

    const remaining = deadlineMs - nowMs;
    if (remaining <= 0) {
      return { ...item, priority: 'overdue', reason: 'Deadline has been reached or passed.' };
    }
    if (remaining <= DAY_MS) {
      return { ...item, priority: 'urgent', reason: 'Deadline is within 24 hours.' };
    }
    if (remaining <= 3 * DAY_MS) {
      return { ...item, priority: 'upcoming', reason: 'Deadline is within 72 hours.' };
    }
    return { ...item, priority: 'normal', reason: 'Deadline is more than 72 hours away.' };
  });

  return result.sort((a, b) => {
    const priorityOrder = rank[a.priority] - rank[b.priority];
    if (priorityOrder !== 0) return priorityOrder;
    if (a.deadline !== null && b.deadline !== null) {
      const deadlineOrder = Date.parse(a.deadline) - Date.parse(b.deadline);
      if (deadlineOrder !== 0) return deadlineOrder;
    }
    const aKey = JSON.stringify([a.kind, a.id]);
    const bKey = JSON.stringify([b.kind, b.id]);
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}


export type ExplainableInvoice = {
  id: string;
  deadline: string | null;
  amount: { value: string; currency: string };
  previousReminders: number;
  openDispute: boolean;
};

function explanationRecord(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) ||
      keys.some(key => !Object.hasOwn(record, key))) {
    throw new Error('Unexpected or missing explanation field');
  }
  return record;
}

// Exact comparison only: no floating-point money arithmetic or currency conversion.
function explanationAmount(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) {
    throw new Error('Amount must be a positive decimal string with at most six decimal places');
  }
  const [whole, fraction = ''] = value.split('.');
  const units = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
  if (units <= 0n) throw new Error('Invoice amount must be positive');
  return units;
}

function explanationInvoice(value: unknown): ExplainableInvoice {
  const record = explanationRecord(value,
    ['id', 'deadline', 'amount', 'previousReminders', 'openDispute']);
  if (typeof record.id !== 'string' || !record.id.trim() || record.id.length > 255) {
    throw new Error('Invalid invoice ID');
  }
  if (record.deadline !== null &&
      (typeof record.deadline !== 'string' || record.deadline.length > 40)) {
    throw new Error('Invalid deadline');
  }
  const amount = explanationRecord(record.amount, ['value', 'currency']);
  explanationAmount(amount.value);
  if (typeof amount.currency !== 'string' || !/^[A-Z]{3}$/.test(amount.currency)) {
    throw new Error('Currency must be a three-letter uppercase code');
  }
  if (typeof record.previousReminders !== 'number' ||
      !Number.isSafeInteger(record.previousReminders) || record.previousReminders < 0) {
    throw new Error('previousReminders must be a nonnegative safe integer');
  }
  if (typeof record.openDispute !== 'boolean') throw new Error('Invalid openDispute');
  return {
    id: record.id,
    deadline: record.deadline,
    amount: { value: amount.value as string, currency: amount.currency },
    previousReminders: record.previousReminders,
    openDispute: record.openDispute,
  };
}

const explanationIdOrder = (a: ExplainableInvoice, b: ExplainableInvoice) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

function explanationDateOrder(a: ExplainableInvoice, b: ExplainableInvoice): number {
  if (a.deadline === null && b.deadline !== null) return 1;
  if (a.deadline !== null && b.deadline === null) return -1;
  const difference = a.deadline !== null && b.deadline !== null
    ? Date.parse(a.deadline) - Date.parse(b.deadline) : 0;
  return difference || explanationIdOrder(a, b);
}

// Read-only advisory policy over caller-supplied snapshots. No store, API or sender.
// The caller supplies a clock so explanations and comparisons are reproducible.
export function explainInvoicePriority(input: unknown) {
  const record = explanationRecord(input, ['invoiceId', 'now', 'invoices']);
  if (typeof record.invoiceId !== 'string' || !record.invoiceId.trim() ||
      record.invoiceId.length > 255) throw new Error('Invalid invoiceId');
  if (typeof record.now !== 'string' || record.now.length > 40) {
    throw new Error('An explicit ISO classification clock is required');
  }
  const now = new Date(record.now);
  // Reuse the existing strict calendar and timezone validation for the clock.
  prioritize([{ id: 'explanation-clock', kind: 'unpaid_invoice', deadline: record.now }], now);
  if (!Array.isArray(record.invoices) || record.invoices.length < 1 || record.invoices.length > 100) {
    throw new Error('Supply between one and 100 invoices');
  }
  const invoices = record.invoices.map(explanationInvoice);
  const classifications = prioritize(invoices.map(invoice => ({
    id: invoice.id, kind: 'unpaid_invoice' as const, deadline: invoice.deadline,
  })), now);
  const currencies = new Set(invoices.map(invoice => invoice.amount.currency));
  if (currencies.size !== 1) throw new Error('Compare amounts only within one currency');
  const selected = invoices.find(invoice => invoice.id === record.invoiceId);
  if (!selected) throw new Error('Requested invoice is absent from the supplied queue');
  const classification = new Map(classifications.map(item => [item.id, item]));
  const amounts = new Map(invoices.map(invoice => [invoice.id, explanationAmount(invoice.amount.value)]));
  const needsReview = (invoice: ExplainableInvoice) => invoice.openDispute || invoice.deadline === null;
  const contextual = [...invoices].sort((a, b) => {
    const reviewOrder = Number(needsReview(a)) - Number(needsReview(b));
    if (reviewOrder) return reviewOrder;
    const urgencyOrder = rank[classification.get(a.id)!.priority] - rank[classification.get(b.id)!.priority];
    if (urgencyOrder) return urgencyOrder;
    const reminderOrder = a.previousReminders - b.previousReminders;
    if (reminderOrder) return reminderOrder;
    const aAmount = amounts.get(a.id)!;
    const bAmount = amounts.get(b.id)!;
    if (aAmount !== bAmount) return aAmount > bAmount ? -1 : 1;
    return explanationDateOrder(a, b);
  });
  const dateOnly = [...invoices].sort(explanationDateOrder);
  const contextualPosition = contextual.findIndex(invoice => invoice.id === selected.id) + 1;
  const dateOnlyPosition = dateOnly.findIndex(invoice => invoice.id === selected.id) + 1;
  const selectedClassification = classification.get(selected.id)!;
  const reasons = [
    selectedClassification.reason,
    `Outstanding amount: ${selected.amount.value} ${selected.amount.currency}. Larger amounts rank first only after urgency and prior-reminder count tie.`,
    `Previous reminders: ${selected.previousReminders}. Within an urgency category, fewer prior reminders rank first.`,
    selected.openDispute
      ? 'An open dispute moves this invoice into manual review after invoices eligible for reminder review.'
      : 'No open dispute was reported in the supplied snapshot.',
  ];
  if (selected.deadline === null) reasons.push('Missing deadline requires manual review before preparing customer contact.');
  const manualReview = needsReview(selected);
  const draft = manualReview
    ? `Review invoice ${selected.id}, outstanding ${selected.amount.value} ${selected.amount.currency}, due ${selected.deadline ?? 'unknown'}, with ${selected.previousReminders} prior reminder(s). ${selected.openDispute ? 'Resolve the open dispute before considering a payment reminder.' : 'Confirm the deadline before considering a payment reminder.'}`
    : `Hello, we are following up on invoice ${selected.id} for ${selected.amount.value} ${selected.amount.currency}, due ${selected.deadline}. Our supplied records show ${selected.previousReminders} previous reminder(s) and no open dispute. Could you confirm its payment status? Thank you.`;
  return {
    invoiceId: selected.id,
    asOf: record.now,
    source: 'Caller-supplied snapshot; not verified against PayPal.',
    fieldsUsed: selected,
    priority: selectedClassification.priority,
    position: contextualPosition,
    isFirst: contextualPosition === 1,
    explanation: `Invoice ${selected.id} ranks ${contextualPosition} of ${invoices.length} under the declared advisory policy.`,
    reasons,
    policy: [
      'Invoices with an open dispute or missing deadline require manual review and follow the other invoices.',
      'Then use existing urgency categories, fewer prior reminders, larger outstanding amount, earliest deadline, and invoice ID.',
      'This is a deterministic heuristic; the calling AI client writes the final explanation and reminder.',
    ],
    comparison: {
      contextualOrder: contextual.map(invoice => invoice.id),
      dateOnlyOrder: dateOnly.map(invoice => invoice.id),
      contextualPosition,
      dateOnlyPosition,
      positionsGained: dateOnlyPosition - contextualPosition,
      dateOnlyPolicy: 'Earliest deadline first, missing deadlines last, invoice ID breaks ties.',
    },
    reminderDraft: {
      audience: manualReview ? 'operator' : 'customer',
      text: draft,
      finalWordingBy: 'calling_ai_client',
      requiresHumanApproval: true,
      manualReviewRequired: manualReview,
    },
    effects: { persisted: false, approved: false, sent: false },
  };
}
