# PayPal Operations Agent

Helps finance teams review PayPal disputes and unpaid invoices and prepare payment reminders that require human approval before sending. Built with TypeScript and Node.js, it includes sandbox MCP tools, a webhook receiver, and a local AG Grid Community demo console with fictional data.

## Install, build, and test

Requires Node.js 22.23.3 or later and npm. Run all commands from the project root:

```sh
npm ci
npm run build
npm test
```

Build before testing: the console API test imports compiled files. The test suite targets Linux and macOS (CI runs on Ubuntu); the approval CLI tests need `python3` to open a pseudo-terminal. Node's TypeScript stripping and built-in SQLite may emit experimental warnings.

## Open the local demo console

No PayPal credentials are required. After installing and building:

```sh
node dist/console-demo-main.js
```

Open http://127.0.0.1:8790 in a browser on the same machine. The server binds exclusively to `127.0.0.1` and serves AG Grid Community from the installed dependency.

The queue contains four fictional disputes and invoices ordered by deadline, with type and deadline filters. Records and AI explanations are explicitly simulated. Deadline filters use the fixed reference time of October 25, 2026 at 12:00 UTC.

Select an invoice and click **Approve: open terminal instructions**. The button saves a simulated reminder draft in `demo-console.sqlite` at the project root and displays its proposal ID, exact content, and review command. It records no approval and sends no reminder. Repeating the request retrieves the same stored draft. Disputes are available for review; reminder proposals apply only to invoices.

From the project root, review the returned proposal in an interactive terminal:

```sh
PAYPAL_DATABASE_PATH=./demo-console.sqlite node dist/approve-reminder.js PROPOSAL_ID
```

Replace `PROPOSAL_ID` with the displayed ID. This environment-variable syntax is for POSIX shells. The CLI displays the exact proposal and requires human confirmation. Approval alone sends nothing. Keep this fictional demo database separate from the sandbox MCP database.

Reject hides an item only for the current browser session. It neither deletes a saved draft nor revokes an existing approval. The demo execution endpoint always rejects execution, including after terminal approval.

## Architecture

An MCP client connects to the executable server over stdio. Four tools expose sandbox dispute and unpaid-invoice reads, persistent reminder proposals, and approved reminder execution. Sandbox adapters authenticate through PayPal OAuth. SQLite stores proposals, approvals, execution attempts, and verified webhook events.

The demo console uses fictional records and a separate SQLite database through the existing ProposalStore. It has no PayPal sender and cannot record approvals.

The interactive terminal CLI lets a human review an exact proposal and approve it for 15 minutes. The MCP executor checks approval and persists an attempt before contacting PayPal, blocking repeat execution across concurrent requests and restarts. Uncertain outcomes require reconciliation. MCP exposes no approval tool.

The separate webhook receiver verifies signatures through PayPal before persistence and deduplicates deliveries durably.

## Sandbox configuration

Supply configuration through the process environment:

- `PAYPAL_ENVIRONMENT=sandbox`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `PAYPAL_WEBHOOK_ID`
- `PAYPAL_DATABASE_PATH=./data/operations.sqlite`

See `.env.example` for configuration names. Load a local environment file explicitly with Node.js; the application does not load it automatically. From the project root:

```sh
node --env-file=.env --experimental-strip-types src/mcp-main.ts
```

For the existing MCP read acceptance command:

```sh
node --env-file=.env --experimental-strip-types src/mcp-read-acceptance.ts
```

Keep `.env` private and excluded from archives. Relative paths resolve from the process working directory, so start the MCP server, webhook receiver, and approval CLI from the project root with the same database setting. Keep the sandbox database separate from the fictional demo database.

Keep credentials and real operational data out of source control, archives, and recordings. The `.gitignore` excludes local environment files except `.env.example`, dependencies, generated output, SQLite databases and their sidecar files, and the `data/` directory. Ignore rules do not remove previously tracked files or sanitize archives automatically.

## Run the MCP server

With sandbox configuration supplied:

```sh
node --experimental-strip-types src/mcp-main.ts
```

The server exposes `list_disputes`, `list_unpaid_invoices`, `propose_invoice_reminder`, and `execute_invoice_reminder`. See `MCP-QUICKSTART.md` for client setup.

## Run the webhook receiver

With sandbox configuration supplied:

```sh
node --experimental-strip-types src/webhook-main.ts
```

The receiver listens on `127.0.0.1:8787`; `PAYPAL_WEBHOOK_PORT` overrides the port. Configure an HTTPS reverse proxy for genuine PayPal delivery. Until `PAYPAL_WEBHOOK_ID` is set, it starts but rejects every delivery without storing it.

To register the webhook and trigger a genuine event:

```sh
PAYPAL_WEBHOOK_URL=https://your-host/your-path node scripts/register-webhook.mjs
# restart the receiver so it loads PAYPAL_WEBHOOK_ID
node scripts/create-webhook-test-invoice.mjs
```

The first script registers six invoice and dispute event types and writes the webhook ID to `.env`. The second creates a fictional draft invoice that is never sent; PayPal then delivers `INVOICING.INVOICE.CREATED`. See `deploy/README.md` for systemd, proxy and EnvironmentFile configuration.

## Review a sandbox reminder

Use the same database setting as the sandbox MCP server and run in an interactive terminal from the project root:

```sh
node --experimental-strip-types src/approve-reminder.ts PROPOSAL_ID
```

Review the invoice and complete message before entering the requested confirmation. Approval alone does not send a reminder. See `OPERATOR-APPROVAL.md`.

## Submission materials

- `SUBMISSION.md`: English Devpost submission draft.
- `VIDEO-SCRIPT.md`: recording plan targeting 2 minutes 40 seconds.

Label simulated footage clearly. Record genuine integration scenes only after verifying them.

## License

MIT; see `LICENSE`.

## Validation status

Verified in the PayPal sandbox on 25 and 26 October 2026: MCP reads, a human-approved reminder sent exactly once, and a genuine webhook delivery verified with PayPal, stored once and deduplicated on redelivery. 56 automated tests pass. Production readiness has not been established. Details in `VALIDATION.md`.
