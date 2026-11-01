# Persistent reminder history and reconciliation

The sandbox console displays persisted proposal, approval, execution attempt and result records. It also displays local reconciliation reviews matched to the same proposal, approval, attempt and invoice. Refresh the console after recording a review.

## Execution history

The executor commits an attempt before invoking the sender. A unique proposal and approval prevent concurrent execution and another send after reopening the database.

A started attempt without a confirmed completion remains uncertain. An ambiguous sender failure is recorded as unknown. A succeeded record means the local sender returned successfully. It does not establish recipient delivery or reading.

## Review an uncertain result

1. Select the proposal in the sandbox console and retain its proposal ID, approval ID, attempt ID and invoice ID.
2. Preserve the original attempt. Do not invoke execution again, delete its record or create a replacement proposal to bypass the block.
3. Inspect available evidence without sending a reminder. Match evidence to this operation. An invoice ID alone cannot identify a particular reminder attempt.
4. Record a local review with ReminderReconciliationStore from dist/reminder-reconciliation.js, using the existing operations database.
5. Refresh the console and inspect the reconciliation reviews alongside the original execution result.

The local operator API is recordReview(input), with these fields:

```js
{
  proposalId,
  approvalId,
  attemptId,
  invoiceId,
  outcome: 'unresolved',
  evidenceKind: 'invoice_read',
  evidenceReference: 'path-to-sanitized-local-evidence.json'
}
```

Close the store when finished. This API records observations locally and has no sender or network client. It is not exposed as a console write route or MCP approval mechanism.

## Evidence and outcomes

Allowed outcomes are unresolved, reported_accepted and reported_not_accepted. Reported outcomes describe operator observations and are not independently verified by the application.

Allowed evidence kinds are invoice_read, creation_webhook, reminder_record and support_confirmation. Invoice reads and creation webhooks can only accompany unresolved reviews. An HTTP 200 invoice read or invoice creation webhook cannot establish reminder acceptance, rejection or delivery.

Use a reported outcome only when reminder-specific evidence supports it and identifies the recorded operation. If evidence is absent or ambiguous, keep the review unresolved.

Reviews append records without changing the original attempt or approval. Even reported_not_accepted does not authorize another send. There is no automatic resend path.

## Console projection

The console exposes bounded review lists and validated identifiers, timestamps and enumerated fields. Messages, payload hashes and free-text evidence references are omitted. Reviews with mismatched operation identifiers are excluded.

Execution uncertainty remains visible even when a review reports acceptance. Recipient delivery and independent verification remain false. An absent local record does not prove that no remote action occurred.

## Local validation

The build passed and all 101 tests passed using temporary databases, fake senders and local fixtures. Coverage includes persistence across connections, operation matching, rejection of insufficient evidence, console redaction and blocked execution after reconciliation.

No real money or calls outside the sandbox were used for this change. Browser presentation and real PayPal reconciliation were not validated by these tests.
