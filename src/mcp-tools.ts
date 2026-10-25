import type { ProposalStore } from './proposals.ts';
import type { ReminderExecutor, ReminderSender } from './reminder-execution.ts';

export type Operations = {
  listDisputes: (limit: number) => Promise<unknown>;
  listUnpaidInvoices: (limit: number) => Promise<unknown>;
  proposals: ProposalStore;
  executor: ReminderExecutor;
  sendReminder: ReminderSender;
};

const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const schema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', properties, required, additionalProperties: false,
});

// Shared registry for the MCP transport. Approval creation is deliberately
// absent: an operator must approve through the separate local interface.
export const toolDefinitions = [
  {
    name: 'list_disputes',
    description: 'Read sandbox disputes for review. Does not modify disputes.',
    inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: 100 } }, []),
  },
  {
    name: 'list_unpaid_invoices',
    description: 'Read unpaid sandbox invoices for review. Does not send reminders.',
    inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: 100 } }, []),
  },
  {
    name: 'propose_invoice_reminder',
    description: 'Persist a reminder draft for separate human review. A draft does not authorize sending.',
    inputSchema: schema({ requestId: text(255), invoiceId: text(255), note: text(1000) },
      ['requestId', 'invoiceId', 'note']),
  },
  {
    name: 'execute_invoice_reminder',
    description: 'Send an existing reminder only after separate approval. Expired or changed approvals and previously attempted proposals are rejected. An uncertain outcome requires reconciliation.',
    inputSchema: schema({ proposalId: text(255) }, ['proposalId']),
  },
] as const;

function objectArguments(value: unknown, allowed: string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Tool arguments must be an object');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !allowed.includes(key))) {
    throw new Error('Unexpected tool argument');
  }
  return record;
}

function requiredText(record: Record<string, unknown>, key: string, maximum: number): string {
  const value = Object.hasOwn(record, key) ? record[key] : undefined;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) {
    throw new Error(`Invalid ${key}`);
  }
  return value;
}

function readLimit(argumentsValue: unknown): number {
  const record = objectArguments(argumentsValue, ['limit']);
  if (!Object.hasOwn(record, 'limit')) return 25;
  const value = record.limit;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 100) {
    throw new Error('limit must be an integer between 1 and 100');
  }
  return value;
}

export function createToolDispatcher(operations: Operations) {
  return async (name: string, argumentsValue: unknown): Promise<unknown> => {
    switch (name) {
      case 'list_disputes':
        return operations.listDisputes(readLimit(argumentsValue));
      case 'list_unpaid_invoices':
        return operations.listUnpaidInvoices(readLimit(argumentsValue));
      case 'propose_invoice_reminder': {
        const record = objectArguments(argumentsValue, ['requestId', 'invoiceId', 'note']);
        return operations.proposals.createReminder({
          requestId: requiredText(record, 'requestId', 255),
          invoiceId: requiredText(record, 'invoiceId', 255),
          note: requiredText(record, 'note', 1000),
        });
      }
      case 'execute_invoice_reminder': {
        const record = objectArguments(argumentsValue, ['proposalId']);
        // No caller-supplied approval, payload, sender or bypass parameter.
        // The executor rechecks the persisted approval and commits the attempt
        // before invoking the configured sender.
        return operations.executor.execute(
          requiredText(record, 'proposalId', 255), operations.sendReminder,
        );
      }
      default:
        throw new Error('Unknown tool');
    }
  };
}
