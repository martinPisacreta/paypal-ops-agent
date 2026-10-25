import type { Configuration } from './config.ts';
import type { Operations } from './mcp-tools.ts';
import { createMcpServer } from './mcp-server.ts';
import { SandboxPayPalHttp } from './paypal-http.ts';
import { createSandboxReminderSender } from './paypal-reminder.ts';
import { createSandboxDisputeReader } from './paypal-disputes.ts';
import { createSandboxUnpaidInvoiceReader } from './paypal-invoices.ts';

// The application supplies persistence and the approval-enforcing executor.
// Read adapters default to sandbox implementations and may be supplied.
// Constructing the server performs no outbound requests.
export function createSandboxPayPalMcpServer(
  configuration: Configuration,
  components: Pick<Operations, 'proposals' | 'executor'> &
    Partial<Pick<Operations, 'listDisputes' | 'listUnpaidInvoices'>>,
) {
  const http = new SandboxPayPalHttp(configuration);
  return createMcpServer({
    proposals: components.proposals,
    executor: components.executor,
    listDisputes: components.listDisputes ?? createSandboxDisputeReader(http),
    listUnpaidInvoices: components.listUnpaidInvoices ??
      createSandboxUnpaidInvoiceReader(http),
    sendReminder: createSandboxReminderSender(http),
  });
}
