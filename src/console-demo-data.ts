export type DemoItemType = 'dispute' | 'invoice';

export interface DemoQueueItem {
  id: string;
  type: DemoItemType;
  title: string;
  amount: string;
  currency: 'USD';
  deadline: string;
  simulatedAiRationale: string;
  simulated: true;
}

// Fixed reference time keeps recordings reproducible. No PayPal data is used.
export const DEMO_AS_OF = '2026-10-25T12:00:00.000Z';

const fixtures: readonly DemoQueueItem[] = [
  {
    id: 'DEMO-DISPUTE-001',
    type: 'dispute',
    title: 'Fictional Store — delivery dispute',
    amount: '149.00',
    currency: 'USD',
    deadline: '2026-10-25T16:00:00.000Z',
    simulatedAiRationale: 'Simulated: review first because the response deadline is four hours away.',
    simulated: true,
  },
  {
    id: 'DEMO-INVOICE-001',
    type: 'invoice',
    title: 'Fictional Store — unpaid service invoice',
    amount: '320.00',
    currency: 'USD',
    deadline: '2026-10-25T10:00:00.000Z',
    simulatedAiRationale: 'Simulated: overdue invoice; review a reminder proposal before any action.',
    simulated: true,
  },
  {
    id: 'DEMO-DISPUTE-002',
    type: 'dispute',
    title: 'Fictional Store — item description dispute',
    amount: '75.50',
    currency: 'USD',
    deadline: '2026-10-27T12:00:00.000Z',
    simulatedAiRationale: 'Simulated: later deadline allows time to review the supporting records.',
    simulated: true,
  },
  {
    id: 'DEMO-INVOICE-002',
    type: 'invoice',
    title: 'Fictional Store — unpaid maintenance invoice',
    amount: '95.00',
    currency: 'USD',
    deadline: '2026-10-26T12:00:00.000Z',
    simulatedAiRationale: 'Simulated: due within one day; inspect before proposing a reminder.',
    simulated: true,
  },
];

export interface DemoQueueFilters {
  type?: DemoItemType;
  deadline?: 'all' | 'overdue' | 'next24h';
}

export function listDemoQueue(filters: DemoQueueFilters = {}): DemoQueueItem[] {
  const reference = Date.parse(DEMO_AS_OF);
  return fixtures
    .filter((item) => !filters.type || item.type === filters.type)
    .filter((item) => {
      const remaining = Date.parse(item.deadline) - reference;
      if (filters.deadline === 'overdue') return remaining < 0;
      if (filters.deadline === 'next24h') {
        return remaining >= 0 && remaining <= 24 * 60 * 60 * 1000;
      }
      return true;
    })
    .sort((left, right) =>
      Date.parse(left.deadline) - Date.parse(right.deadline) ||
      left.id.localeCompare(right.id),
    )
    .map((item) => ({ ...item }));
}
