import test from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxReminderSender } from '../src/paypal-reminder.ts';

const input = {
  invoiceId: 'INV2-FICTIONAL-TEST',
  note: 'Simulated reminder only.',
  attemptId: 'local-fictional-attempt',
};

test('sandbox reminder targets the reviewed invoice and recipient', async () => {
  const calls = [];
  const send = createSandboxReminderSender({
    request: async (...args) => {
      calls.push(args);
      return { status: 204, body: null };
    },
  });
  await send(input);
  assert.deepEqual(calls, [[
    'POST', '/v2/invoicing/invoices/INV2-FICTIONAL-TEST/remind',
    { note: input.note, send_to_recipient: true, send_to_invoicer: false },
  ]]);
});

test('ambiguous reminder outcomes propagate without another request', async () => {
  for (const outcome of ['transport-failure', 'unexpected-response']) {
    let calls = 0;
    const send = createSandboxReminderSender({
      request: async () => {
        calls++;
        if (outcome === 'transport-failure') {
          throw new Error('Simulated uncertain delivery');
        }
        return { status: 202, body: null };
      },
    });
    await assert.rejects(send(input));
    assert.equal(calls, 1);
  }
});

test('invalid invoice paths cannot invoke the reminder transport', async () => {
  let calls = 0;
  const send = createSandboxReminderSender({
    request: async () => { calls++; return { status: 204, body: null }; },
  });
  for (const invoiceId of ['', '../other', 'invoice?recipient=other', 'invoice/other']) {
    await assert.rejects(send({ ...input, invoiceId }));
  }
  assert.equal(calls, 0);
});
