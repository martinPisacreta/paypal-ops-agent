import test from 'node:test';
import assert from 'node:assert/strict';
import { explainInvoicePriority } from '../src/priorities.ts';
import { createToolDispatcher, toolDefinitions } from '../src/mcp-tools.ts';

const now = '2026-10-28T12:00:00Z';
const invoice = (id, overrides = {}) => ({
  id, deadline: '2026-10-27T09:00:00Z',
  amount: { value: '100.00', currency: 'USD' },
  previousReminders: 0, openDispute: false, ...overrides,
});
const fixture = () => ({
  invoiceId: 'selected', now,
  invoices: [
    invoice('early', { deadline: '2026-10-26T09:00:00Z', previousReminders: 3 }),
    invoice('selected', { amount: { value: '500.00', currency: 'USD' } }),
    invoice('other', { deadline: '2026-10-27T10:00:00Z' }),
    invoice('disputed', { deadline: '2026-10-25T09:00:00Z', openDispute: true }),
  ],
});

test('explains the contextual leader and compares its actual date-only position', () => {
  const result = explainInvoicePriority(fixture());
  assert.equal(result.isFirst, true);
  assert.equal(result.position, 1);
  assert.deepEqual(result.comparison.contextualOrder, ['selected', 'other', 'early', 'disputed']);
  assert.deepEqual(result.comparison.dateOnlyOrder, ['disputed', 'early', 'selected', 'other']);
  assert.equal(result.comparison.dateOnlyPosition, 3);
  assert.equal(result.comparison.positionsGained, 2);
  assert.equal(result.priority, 'overdue');
});

test('does not claim a non-leading invoice goes first', () => {
  const result = explainInvoicePriority({ ...fixture(), invoiceId: 'early' });
  assert.equal(result.isFirst, false);
  assert.equal(result.position, 3);
  assert.match(result.explanation, /ranks 3 of 4/);
  assert.equal(result.comparison.positionsGained, -1);
});

test('draft and evidence include all four supplied factors', () => {
  const result = explainInvoicePriority(fixture());
  assert.deepEqual(result.fieldsUsed, fixture().invoices[1]);
  for (const value of ['selected', '500.00 USD', '2026-10-27T09:00:00Z',
    '0 previous reminder(s)', 'no open dispute']) {
    assert.ok(result.reminderDraft.text.includes(value), value);
  }
  assert.equal(result.reminderDraft.audience, 'customer');
  assert.equal(result.reminderDraft.finalWordingBy, 'calling_ai_client');
  assert.equal(result.reminderDraft.requiresHumanApproval, true);
  assert.deepEqual(result.effects, { persisted: false, approved: false, sent: false });
  assert.match(result.source, /not verified against PayPal/);
});

test('an open dispute produces an operator review draft', () => {
  const result = explainInvoicePriority({ ...fixture(), invoiceId: 'disputed' });
  assert.equal(result.position, 4);
  assert.equal(result.reminderDraft.audience, 'operator');
  assert.equal(result.reminderDraft.manualReviewRequired, true);
  assert.match(result.reminderDraft.text, /Resolve the open dispute/);
});

test('a missing deadline is placed in manual review and last by date', () => {
  const result = explainInvoicePriority({ invoiceId: 'unknown', now, invoices: [
    invoice('unknown', { deadline: null }), invoice('known'),
  ] });
  assert.equal(result.priority, 'needs_review');
  assert.equal(result.position, 2);
  assert.equal(result.comparison.dateOnlyPosition, 2);
  assert.equal(result.reminderDraft.manualReviewRequired, true);
  assert.equal(result.reminderDraft.audience, 'operator');
  assert.match(result.reminderDraft.text, /Confirm the deadline/);
});

test('urgency takes precedence over amount and reminder count', () => {
  const result = explainInvoicePriority({ invoiceId: 'overdue', now, invoices: [
    invoice('future', { deadline: '2026-10-29T00:00:00Z',
      amount: { value: '999999.00', currency: 'USD' } }),
    invoice('overdue', { previousReminders: 10,
      amount: { value: '1.00', currency: 'USD' } }),
  ] });
  assert.deepEqual(result.comparison.contextualOrder, ['overdue', 'future']);
});

test('within one urgency category fewer reminders precede larger amounts', () => {
  const result = explainInvoicePriority({ invoiceId: 'fresh', now, invoices: [
    invoice('repeated', { previousReminders: 2,
      amount: { value: '10000.00', currency: 'USD' } }),
    invoice('fresh', { amount: { value: '1.00', currency: 'USD' } }),
  ] });
  assert.deepEqual(result.comparison.contextualOrder, ['fresh', 'repeated']);
});

test('amount comparison preserves precision beyond floating-point money values', () => {
  const result = explainInvoicePriority({ invoiceId: 'larger', now, invoices: [
    invoice('smaller', { amount: { value: '999999999999.999998', currency: 'USD' } }),
    invoice('larger', { amount: { value: '999999999999.999999', currency: 'USD' } }),
  ] });
  assert.deepEqual(result.comparison.contextualOrder, ['larger', 'smaller']);
});

test('ties use deadline and then ID independently of input order', () => {
  const input = { invoiceId: 'a', now, invoices: [
    invoice('z', { deadline: '2026-10-27T10:00:00Z' }), invoice('b'), invoice('a'),
  ] };
  const first = explainInvoicePriority(input);
  const second = explainInvoicePriority({ ...input, invoices: [...input.invoices].reverse() });
  assert.deepEqual(first.comparison.contextualOrder, ['a', 'b', 'z']);
  assert.deepEqual(first.comparison, second.comparison);
});

test('does not mutate caller snapshots and is reproducible', () => {
  const input = fixture();
  const before = JSON.stringify(input);
  for (const item of input.invoices) {
    Object.freeze(item.amount); Object.freeze(item);
  }
  Object.freeze(input.invoices); Object.freeze(input);
  assert.deepEqual(explainInvoicePriority(input), explainInvoicePriority(input));
  assert.equal(JSON.stringify(input), before);
});

test('rejects invalid clocks and invalid invoice calendar timestamps', () => {
  for (const invalid of ['2026-02-30T12:00:00Z', '2026-10-28T12:00:00', 'invalid']) {
    assert.throws(() => explainInvoicePriority({ ...fixture(), now: invalid }));
    assert.throws(() => explainInvoicePriority({ invoiceId: 'bad', now,
      invoices: [invoice('bad', { deadline: invalid })] }));
  }
});

test('rejects ambiguous queues, mixed currencies and unexpected fields', () => {
  const cases = [
    { ...fixture(), invoiceId: 'absent' },
    { ...fixture(), invoices: [] },
    { ...fixture(), invoices: [invoice('selected'), invoice('selected')] },
    { ...fixture(), invoices: Array.from({ length: 101 }, (_, i) => invoice(String(i))) },
    { ...fixture(), invoices: [invoice('selected'), invoice('eur', {
      amount: { value: '100', currency: 'EUR' } })] },
    { ...fixture(), approved: true },
    { ...fixture(), invoices: [invoice('selected', { approved: true })] },
  ];
  for (const input of cases) assert.throws(() => explainInvoicePriority(input));
});

test('rejects malformed amounts, reminder counts and dispute flags', () => {
  for (const value of ['0', '-1', '1e3', '1.0000001', '1000000000000', 100]) {
    assert.throws(() => explainInvoicePriority({ invoiceId: 'bad', now,
      invoices: [invoice('bad', { amount: { value, currency: 'USD' } })] }));
  }
  for (const previousReminders of [-1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => explainInvoicePriority({ invoiceId: 'bad', now,
      invoices: [invoice('bad', { previousReminders })] }));
  }
  assert.throws(() => explainInvoicePriority({ invoiceId: 'bad', now,
    invoices: [invoice('bad', { openDispute: 'false' })] }));
});

test('MCP advertises read-only behavior and required snapshot fields', () => {
  const definition = toolDefinitions.find(tool => tool.name === 'explain_invoice_priority');
  assert.ok(definition);
  assert.equal(definition.annotations.readOnlyHint, true);
  assert.equal(definition.annotations.destructiveHint, false);
  assert.deepEqual(definition.inputSchema.required, ['invoiceId', 'now', 'invoices']);
  assert.equal(definition.inputSchema.additionalProperties, false);
  assert.ok(toolDefinitions.some(tool => tool.name === 'propose_invoice_reminder'));
  assert.ok(toolDefinitions.some(tool => tool.name === 'execute_invoice_reminder'));
});

test('MCP explanation never accesses API, proposal, approval or execution dependencies', async () => {
  const accesses = [];
  const operations = new Proxy({}, { get(_target, property) {
    accesses.push(property);
    throw new Error(`Unexpected dependency access: ${String(property)}`);
  } });
  const dispatch = createToolDispatcher(operations);
  const result = await dispatch('explain_invoice_priority', fixture());
  assert.deepEqual(result, explainInvoicePriority(fixture()));
  await assert.rejects(dispatch('explain_invoice_priority', { ...fixture(), send: true }));
  assert.deepEqual(accesses, []);
});
