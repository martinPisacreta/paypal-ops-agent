# PayPal sandbox acceptance

Full sandbox acceptance remains incomplete.

## Verified evidence

- Compilation and 56 local tests passed.
- Authenticated sandbox reads succeeded through MCP for disputes and unpaid invoices.
- MCP returned both controlled fictional invoices.
- Both fictional invoices were activated without recipient or invoicer notifications.
- A reminder proposal was persisted and reconciled against its intended invoice and exact text. No reminder has been sent.

Proposal: `24d9d6ca-e3d2-4d78-af9b-86d038cff8d1`

Invoice: `INV2-RNWZ-5LKH-446E-ZJEU`

Review the exact reminder in [the review artifact](../data/REMINDER-REVIEW-2026-10-25.md).

## Required human review

Follow [OPERATOR-APPROVAL.md](../OPERATOR-APPROVAL.md). From the project root, using the same SQLite database as MCP, run in an interactive terminal:

```sh
PAYPAL_DATABASE_PATH=./data/operations.sqlite node --experimental-strip-types ./src/approve-reminder.ts 24d9d6ca-e3d2-4d78-af9b-86d038cff8d1
```

Review the displayed invoice and exact note before confirming. Do not automate confirmation. Approval alone does not send the reminder.

## Remaining acceptance

1. Record genuine human approval of the exact proposal.
2. Execute that proposal through MCP within the approval's 15-minute validity period and verify the sandbox outcome. Reconcile uncertain outcomes before any retry.
3. Verify genuine webhook delivery, signature verification, and durable deduplication through the configured receiver.

Keep each result as separate evidence. Simulated tests do not establish genuine reminder execution or webhook delivery.

## Configuration

Use sandbox credentials supplied locally; never commit or paste them into reports. Commands requiring `.env` values must explicitly load that file, for example with Node's `--env-file=.env`. Keep `PAYPAL_DATABASE_PATH` stable and shared across MCP, approval, and webhook processes. Preserve earlier failed acceptance records.


## Update: approved reminder executed

The earlier approval-pending and reminder-not-sent statements describe preparation. Martin subsequently approved the exact proposal, and MCP execution returned `succeeded`. A subsequent sandbox invoice lookup returned HTTP 200. See `../VALIDATION.md` for the recorded result and evidence limits. Do not repeat the reminder. Genuine webhook delivery remains unverified.
