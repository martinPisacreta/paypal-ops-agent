# PayPal Operations Agent

## What it does

PayPal Operations Agent helps operators review disputes and unpaid invoices, receive verified webhook events, and prepare invoice reminders through a Model Context Protocol (MCP) interface. It is designed for use from an assistant such as Claude, with a separate human approval step before a reminder can be sent.

## Who it is for

Small businesses and operations teams that need to keep track of payment issues without giving an AI assistant unrestricted permission to contact customers. Dispute and invoice information supports human triage; reminder drafts remain separate from authorization and execution.

## How we built it

The project uses TypeScript, Node.js, SQLite, the MCP SDK, and PayPal sandbox APIs. Read adapters retrieve disputes and unpaid invoices. A webhook receiver verifies signatures through PayPal before storing events and deduplicates repeat deliveries.

Reminder proposals are stored durably. A separate terminal interface lets an operator review the exact proposal and approve it for a limited time. The executor checks that approval and records an attempt before contacting PayPal, preventing repeated execution after concurrent requests or restarts. Uncertain outcomes require reconciliation.

## How we used AI

An AI coding agent assisted with implementation, integration tests, debugging, and documentation. Claude is the intended conversational MCP client; a genuine Claude-to-PayPal sandbox demonstration remains pending.

## Challenges

The main challenge was separating an assistant's suggestion from a person's authorization. Other challenges included preserving approvals across restarts, handling ambiguous network outcomes without duplicate reminders, and keeping credentials out of diagnostics.

## Validation and what comes next

The latest completed local validation passed compilation and 50 tests. Those tests use controlled fixtures and simulated transports; they do not establish genuine PayPal sandbox acceptance.

Next, we will supply sandbox credentials, verify authenticated reads through MCP, demonstrate a human-approved reminder against a controlled sandbox invoice, and confirm genuine verified webhook delivery. We will then use operator feedback to improve triage and usability.
