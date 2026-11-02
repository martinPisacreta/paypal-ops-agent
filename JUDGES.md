# Judge quickstart

Try the fictional console and automated tests without PayPal credentials. Allow approximately 10 minutes; dependency download time varies. No PayPal account or environment file is needed for this walkthrough.

## Requirements

- Node.js 22.23.3 or later and npm.
- Linux or macOS with `python3` available: approval CLI tests use a pseudo-terminal.
- Internet access to install npm dependencies.
- A browser on the same machine as the console.

Run the following commands from the repository root.

## 1. Install, build, and test

```sh
npm ci
npm run build
npm test
```

Expected on the documented Linux environment: installation and TypeScript compilation complete successfully, then the test runner reports no failed tests. See the Windows validation note below for platform-specific test limitations. Build before testing because console tests import compiled files. Node may print experimental warnings for TypeScript stripping or SQLite.

The tests exercise local behavior, including priority explanations, proposal persistence, approval checks, execution safeguards, history, and console HTTP routes with test fixtures. Passing tests do not establish live PayPal delivery or production readiness.

## Windows validation note

The build and fictional console were validated on Windows, including HTTP 200 at `http://127.0.0.1:8790/`. The latest Windows run (1 November 2026, commit 071ffb6, Node 22.23.3) passed 101 of 105 tests. Four tests depend on POSIX terminal or process behavior:

- `terminal approval authorizes the reviewed synthetic proposal once`
- `terminal cancellation records no approval`
- `proposal changes during review prevent approval`
- `webhook executable initializes storage and exits cleanly on SIGTERM`

The first three use `python3` and a POSIX pseudo-terminal to exercise interactive approval. The fourth expects graceful POSIX SIGTERM handling, which Windows process termination does not reproduce. These are test-platform limitations; the other 101 tests passed in that Windows run. Run the complete suite in the documented Linux environment to validate those four cases. On Linux, GitHub Actions runs all 105 tests on every push.

## 2. Open the fictional console

```sh
node dist/console-demo-main.js
```

Leave this terminal running and open:

```text
http://127.0.0.1:8790/
```

Use the command exactly as shown, without `--sandbox` or `--env-file`. This mode uses fictional records, creates a local `demo-console.sqlite` database, and does not configure a PayPal connection. The server listens only on `127.0.0.1`.

### If port 8790 is already occupied

Leave the existing process running. From the repository root, run this alternative in a POSIX shell. It starts the fictional console on an automatically selected free loopback port and prints its URL:

```sh
node --input-type=module <<'NODE'
import { startDemoConsole } from './dist/console-demo-server.js';
import { ProposalStore } from './dist/proposals.js';
const store = new ProposalStore('./demo-console.sqlite');
let server;
try {
  server = await startDemoConsole(0, { proposalStore: store });
} catch (error) {
  store.close();
  throw error;
}
console.log(`Fictional console: http://127.0.0.1:${server.address().port}/`);
let closing = false;
const shutdown = () => {
  if (closing) return;
  closing = true;
  server.close(() => store.close());
  server.closeAllConnections();
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
NODE
```

Open the printed URL and continue with the interactions below. Press **Ctrl+C** in this terminal when finished. This alternative uses the fictional database and does not configure sandbox access.


Expected: a queue of four fictional disputes and invoices, with deadline ordering, type and deadline filters, and simulated explanations. Deadline filters use the fixed reference time October 25, 2026 at 12:00 UTC.

Try these interactions:

1. Change the type and deadline filters. The displayed queue changes; this demonstrates reviewing a small simulated workload.
2. Select an invoice and inspect its simulated explanation. These fictional explanations do not demonstrate a live AI model or verified customer context.
3. Click **Approve: open terminal instructions**. The console saves a simulated reminder draft and displays its proposal ID, content, and terminal review command. Despite the button label, this step does not approve or send the reminder.
4. Repeat the draft request for the same invoice. The existing draft is returned rather than creating another one.

Disputes can be reviewed, but reminder drafts apply only to invoices. Reject hides an item for the current browser session; it does not delete a stored draft or revoke an approval.

You can finish the walkthrough without running the displayed approval command. Human approval is a separate interactive terminal step; approval alone sends nothing. The fictional console always rejects execution and has no PayPal sender. Automated tests exercise the execution safeguards with test dependencies.

## 3. Stop the console

Return to its terminal and press **Ctrl+C**. Wait for the process to exit. The fictional SQLite database remains locally for subsequent runs.

## Optional: use your own PayPal sandbox

This section is separate from the credential-free walkthrough and is not required for judging it.

Follow [MCP-QUICKSTART.md](MCP-QUICKSTART.md) for MCP client setup and [README.md](README.md#sandbox-configuration) for configuration. Supply your own sandbox client ID and secret, set `PAYPAL_ENVIRONMENT=sandbox`, and choose a sandbox database path separate from `demo-console.sqlite`. Webhook verification additionally requires your own sandbox webhook ID.

If you keep configuration in a private local `.env` file, the sandbox MCP server can be started with:

```sh
node --env-file=.env --experimental-strip-types src/mcp-main.ts
```

For the read-only sandbox console, first initialize the sandbox database through the MCP workflow, then run:

```sh
node --env-file=.env dist/console-demo-main.js --sandbox
```

Open `http://127.0.0.1:8790/sandbox` on the same machine. This view reads sandbox unpaid invoices and local proposal history. Reminder counts and dispute context may be unknown; priority comparisons label their assumptions. The root page remains a separate fictional view.

The sandbox console does not approve or execute reminders. Consult [OPERATOR-APPROVAL.md](OPERATOR-APPROVAL.md) before using the separate approval and MCP execution workflow. A recorded execution result does not independently verify receipt by the recipient.

Keep `.env`, credentials, and SQLite files out of submissions, screenshots, and source control. Stop the console with **Ctrl+C** when finished.
