import type { SandboxPayPalHttp } from './paypal-http.ts';
import type { ReminderSender } from './reminder-execution.ts';

// Wire this sender through ReminderExecutor so approval and durable attempt
// checks run before any outbound request. This adapter never retries.
export function createSandboxReminderSender(
  http: Pick<SandboxPayPalHttp, 'request'>,
): ReminderSender {
  return async ({ invoiceId, note, attemptId }) => {
    if (typeof invoiceId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,255}$/.test(invoiceId) ||
        typeof note !== 'string' || !note.trim() ||
        typeof attemptId !== 'string' || !attemptId.trim()) {
      throw new Error('Invalid sandbox reminder input');
    }

    // attemptId belongs to local auditing; it is not a PayPal idempotency key.
    const response = await http.request(
      'POST', '/v2/invoicing/invoices/' + invoiceId + '/remind',
      { note, send_to_recipient: true, send_to_invoicer: false },
    );
    if (response.status !== 204) {
      throw new Error('Unexpected reminder response; reconcile with PayPal before further action');
    }
  };
}
