import { resolve } from 'node:path';

export type Configuration = {
  environment: 'sandbox';
  clientId: string;
  clientSecret: string;
  webhookId: string;
  databasePath: string;
};

// Read configuration explicitly. Importing this module performs no I/O,
// creates no approvals and makes no requests to PayPal.
export function loadConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
  options: { requireWebhookId?: boolean } = {},
): Configuration {
  const selectedEnvironment = environment.PAYPAL_ENVIRONMENT ?? 'sandbox';
  if (selectedEnvironment !== 'sandbox') {
    throw new Error('Only the PayPal sandbox environment is supported');
  }

  const required = (name: string): string => {
    const value = environment[name];
    if (typeof value !== 'string' || !value.trim() ||
        value !== value.trim() || /[\r\n\0]/.test(value)) {
      // Include the setting name only; never include credential values.
      throw new Error(`Missing or invalid configuration: ${name}`);
    }
    return value;
  };

  return {
    environment: 'sandbox',
    clientId: required('PAYPAL_CLIENT_ID'),
    clientSecret: required('PAYPAL_CLIENT_SECRET'),
    webhookId: options.requireWebhookId === false &&
      (environment.PAYPAL_WEBHOOK_ID === undefined ||
       environment.PAYPAL_WEBHOOK_ID === '')
      ? '' : required('PAYPAL_WEBHOOK_ID'),
    databasePath: resolve(required('PAYPAL_DATABASE_PATH')),
  };
}
