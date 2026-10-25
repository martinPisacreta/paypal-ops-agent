# PayPal sandbox MCP quickstart

The stdio executable is `src/mcp-main.ts`. It loads sandbox configuration, initializes SQLite storage, and exposes four MCP tools.

## Configure your MCP client

Merge this entry into your client's MCP server configuration. Replace every placeholder locally before starting the server. Do not commit credentials.

```json
{
  "mcpServers": {
    "paypal-sandbox": {
      "command": "node",
      "args": [
        "--experimental-strip-types",
        "./src/mcp-main.ts"
      ],
      "env": {
        "PAYPAL_ENVIRONMENT": "sandbox",
        "PAYPAL_CLIENT_ID": "REPLACE_WITH_SANDBOX_CLIENT_ID",
        "PAYPAL_CLIENT_SECRET": "REPLACE_WITH_SANDBOX_CLIENT_SECRET",
        "PAYPAL_WEBHOOK_ID": "REPLACE_WITH_SANDBOX_WEBHOOK_ID",
        "PAYPAL_DATABASE_PATH": "./data/operations.sqlite"
      }
    }
  }
}
```

Start the MCP client with the project root as its working directory so the relative executable and database paths resolve correctly. Configure that working directory in your client if it launches servers elsewhere. The project requires Node.js >=22.23.3 and installed dependencies. All five environment settings above are required by the current configuration loader. Production mode is rejected.

Keep the database path stable across restarts: it stores reminder proposals, approvals, and execution attempts. The webhook process and operator approval interface must use the same database when participating in the same workflow.

## Read behavior

Disputes and invoices use bounded, single-page reads. Inspect the returned pagination metadata before treating a response as complete. Invoice reads filter the fetched page locally for SENT, UNPAID, and PARTIALLY_PAID statuses; an empty filtered page can still have more pages.

## Reminder workflow

Creating a reminder proposal does not authorize sending it. Approval is separate from MCP and must come through the local operator interface. Execution checks the persisted approval and reviewed payload. For an uncertain execution outcome, reconcile the persisted attempt with PayPal before attempting another send.

## Validation status

The latest recorded local validation passed compilation and all 46 tests, including stdio startup and tool discovery. Tests use simulated PayPal responses; they do not establish genuine PayPal sandbox acceptance.

Remaining acceptance work includes authenticated sandbox reads, the operator approval workflow, a controlled sandbox reminder, and verified webhook delivery. Start MCP from the client; starting it alone in a terminal does not exercise the MCP protocol or validate PayPal credentials.
