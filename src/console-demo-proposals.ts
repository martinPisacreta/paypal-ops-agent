import { DEMO_AS_OF, listDemoQueue } from './console-demo-data.js';

interface DemoProposalStore<T> {
  createReminder(input: {
    requestId: string;
    invoiceId: string;
    note: string;
  }): T;
}

// Creates only a draft from trusted fictional fixtures.
// Approval remains exclusively in the existing interactive terminal CLI.
export function prepareDemoReminder<T>(
  store: DemoProposalStore<T>,
  itemId: unknown,
) {
  if (typeof itemId !== 'string') {
    throw new Error('Select a simulated invoice');
  }
  const item = listDemoQueue().find(candidate => candidate.id === itemId);
  if (!item || item.type !== 'invoice' || item.simulated !== true) {
    throw new Error('Select a simulated invoice');
  }

  const proposal = store.createReminder({
    requestId: `demo-console:${DEMO_AS_OF}:${item.id}`,
    invoiceId: item.id,
    note: `SIMULATED DEMO ONLY: Reminder for fictional invoice ${item.id}, amount ${item.amount} ${item.currency}. This draft has no real customer recipient.`,
  });

  return {
    simulated: true,
    proposal,
    approvalRecorded: false,
    executed: false,
  };
}
