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
