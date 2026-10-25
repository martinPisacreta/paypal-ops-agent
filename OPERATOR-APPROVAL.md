# Operator approval for sandbox reminders

Reminder proposals require a separate human approval before MCP can execute them. The approval command records authorization locally and never contacts PayPal.

## Review and approve

1. Create a reminder proposal through MCP and retain its returned proposal ID.
2. Open an interactive terminal on the machine containing the project and its SQLite database. Use the same database path configured for MCP.
3. From the project root, run the command below, replacing `PROPOSAL_ID` with the returned ID:

```sh
PAYPAL_DATABASE_PATH=./data/operations.sqlite \
node --experimental-strip-types \
./src/approve-reminder.ts PROPOSAL_ID
```

4. Read the displayed proposal, including its invoice ID and exact note. Confirm only if you authorize that content. The required answer is `APPROVE` followed by the displayed proposal ID in double quotes; copy the format shown by the prompt. Any other answer cancels.
5. After approval is recorded, request execution through MCP using the same proposal ID within 15 minutes. Approval alone does not send the reminder.

The command requires interactive input and output. Piped input is rejected. Changes to the proposal during review prevent approval; changes after approval invalidate the approved content. MCP exposes no approval tool.

## Execution outcomes

The executor records an attempt before contacting PayPal. An existing attempt blocks another execution of the same proposal across concurrent connections and restarts.

A failed execution response can represent an uncertain remote outcome. Reconcile the stored attempt with PayPal before taking further action. Do not create a replacement proposal merely to retry an uncertain send.

Approval records are unique per proposal. The current command does not renew an existing approval. If an approval expires, review the situation before creating a new proposal, and first establish that the original has no execution attempt.

## Validation and remaining acceptance

Compilation and all 50 local tests passed in the recorded run at 2026-10-25T11:41:50Z. The approval tests use temporary synthetic proposals, a simulated terminal, and an in-memory sender. They establish neither an actual operator approval nor genuine PayPal sandbox acceptance.

Remaining acceptance requires authenticated sandbox reads, a human review of a controlled sandbox proposal, execution against the intended sandbox invoice, and verified webhook delivery. Record those results separately from simulated tests. Never include credentials in the acceptance record.
