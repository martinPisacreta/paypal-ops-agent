import type { Configuration } from './config.ts';
import type { SandboxPayPalHttp } from './paypal-http.ts';
import type { SignatureVerifier } from './webhooks.ts';

export function createSandboxWebhookVerifier(
  configuration: Configuration,
  http: Pick<SandboxPayPalHttp, 'request'>,
): SignatureVerifier {
  const webhookId = configuration.webhookId;
  if (configuration.environment !== 'sandbox' ||
      typeof webhookId !== 'string' || !webhookId.trim() ||
      webhookId !== webhookId.trim() || /[\r\n\0]/.test(webhookId)) {
    throw new Error('Valid PayPal sandbox webhook configuration is required');
  }

  return async (headers, event) => {
    const requiredHeader = (name: string): string => {
      const value = headers[name];
      if (typeof value !== 'string' || !value.trim() ||
          /[\r\n\0]/.test(value)) {
        throw new Error('Missing or invalid PayPal verification headers');
      }
      return value;
    };

    const body = {
      auth_algo: requiredHeader('paypal-auth-algo'),
      cert_url: requiredHeader('paypal-cert-url'),
      transmission_id: requiredHeader('paypal-transmission-id'),
      transmission_sig: requiredHeader('paypal-transmission-sig'),
      transmission_time: requiredHeader('paypal-transmission-time'),
      webhook_id: webhookId,
      webhook_event: event,
    };
    // Transport errors propagate; the inbox must not persist the event.
    const response = await http.request(
      'POST', '/v1/notifications/verify-webhook-signature', body,
    );
    const result = response.body;
    return response.status === 200 &&
      typeof result === 'object' && result !== null &&
      !Array.isArray(result) &&
      (result as Record<string, unknown>).verification_status === 'SUCCESS';
  };
}
