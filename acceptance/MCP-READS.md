# Authenticated sandbox reads through MCP

The MCP acceptance client compiled successfully and the local regression suite passed. Authenticated PayPal sandbox acceptance remains unverified because the available configuration was missing or invalid.

## Prerequisites

Install project dependencies and supply PAYPAL_ENVIRONMENT=sandbox, PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_WEBHOOK_ID and PAYPAL_DATABASE_PATH through the process environment. Use sandbox credentials and the intended persistent database path. The command does not automatically load .env files. Keep credentials out of reports and version control.

## Run

From the project root:

```sh
node --experimental-strip-types src/mcp-read-acceptance.ts
```

The client starts the actual MCP executable over stdio, discovers the two read tools and calls list_disputes and list_unpaid_invoices with limit=1. Starting the server initializes its SQLite storage. The client does not request reminder proposals, approvals or execution.

## Interpret the report

Exit code 0 and sandboxMcpReadsVerified=true indicate that configuration loaded, MCP connected, both read tools were discovered, both returned an items array and transport cleanup succeeded. Empty arrays establish successful empty reads, not populated-data behavior or complete pagination.

Exit code 1 means acceptance was not established. Inspect configurationLoaded, mcpConnected, readToolsDiscovered and the individual checks to locate the failed stage. Correct the identified blocker before repeating the command. Reports deliberately omit raw responses, credentials and underlying errors.

Preserve each report separately, including failed attempts. fullSandboxAcceptanceVerified remains false: operator approval, controlled reminder execution and genuine verified webhook delivery require their own evidence. Follow OPERATOR-APPROVAL.md and acceptance/README.md for those remaining steps.
