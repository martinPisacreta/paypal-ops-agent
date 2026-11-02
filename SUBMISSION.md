# PayPal Operations Agent

## What it does

PayPal Operations Agent is a sandbox prototype for the administrative lead at a small agency who reviews overdue invoices and decides which customer to follow up with first. For a supplied invoice snapshot, it explains the priority using the deadline, outstanding amount, previous reminders and open dispute status, compares that position with deadline-only ordering, and returns a draft for the calling AI client to rewrite. A person reviews and approves the exact reminder in a separate terminal before controlled sandbox execution. Our hypothesis is that this workflow could make follow-up decisions easier; we have not measured real-user adoption, time savings or collection outcomes.

## Who it is for

Small businesses and operations teams that want help from an AI assistant without giving it unrestricted permission to contact customers.

## How we built it

TypeScript and Node.js, SQLite, the MCP SDK, AG Grid Community and the PayPal REST APIs (OAuth, Disputes, Invoicing, Webhooks) in the sandbox.

- An MCP server exposes six tools: `list_disputes`, `list_unpaid_invoices`, `explain_invoice_priority`, `get_reminder_history`, `propose_invoice_reminder`, and `execute_invoice_reminder`. Claude or any MCP client can use them.
- Reminder proposals are stored durably. A separate terminal lets the operator review the exact proposal and approve it for 15 minutes. Any change to the proposal invalidates the approval, and the MCP server has no approval tool.
- The executor checks the approval and records an attempt before calling PayPal, so a retry, a crash or a concurrent request cannot send the same reminder twice. Uncertain outcomes require reconciliation instead of a blind retry.
- A webhook receiver verifies every event with PayPal before storing it and ignores duplicate deliveries.
- The AG Grid console sorts disputes and invoices by deadline, with type and due-date filters, and shows why each item matters. It runs locally with fictional records.

## How we used AI

The agent's job is triage and drafting: it explains why an item is urgent and writes the reminder text. An AI coding agent also helped with implementation, tests, debugging and documentation. Authorization is deliberately kept outside the AI.

## Validation

In the PayPal sandbox (25 and 26 October 2026):

- A real MCP client read disputes and unpaid invoices through the official APIs (`src/mcp-read-acceptance.ts`, notes in `acceptance/MCP-READS.md`).
- A fictional sandbox invoice received a reminder proposal, a human approved it in the terminal, and the MCP executor sent it exactly once (attempt recorded, invoice read back with HTTP 200, no repeated send).
- The automated suite had 56 passing tests at the time of the sandbox validation. It has since grown to 105 tests, which run on every push in GitHub Actions on Ubuntu.

- A genuine PayPal webhook event (`INVOICING.INVOICE.CREATED` for a fictional draft invoice) reached the public receiver, was verified with PayPal and stored once. A redelivery of the same event was answered and ignored as a duplicate.

Details and identifiers are in VALIDATION.md.

## Challenges

Separating an assistant's suggestion from a person's authorization, preserving approvals across restarts, handling ambiguous network outcomes without duplicate reminders, and keeping credentials out of logs and diagnostics.

## What comes next

Dispute responses prepared for human review, more reminder channels, and feedback from real operators on the triage order.
