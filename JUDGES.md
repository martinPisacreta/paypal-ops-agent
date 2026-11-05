# Judge quickstart
**No installation:** a hosted static version of the fictional console runs in any browser at <https://tienda.textokit.store/paypal-demo/>. See [Hosted static demo](#hosted-static-demo).
## Option 1: five-minute document review — no installation

This route uses repository documents only. No account, credentials, downloads or commands are required.

1. **0:00–1:00 — The administrative problem.** Read [What it does](SUBMISSION.md#what-it-does): an administrative lead reviews overdue invoices while retaining control over customer contact. Business impact remains a hypothesis; no collection improvement has been measured.
2. **1:00–2:00 — One fictional invoice.** Illustrative example only: an agency reviews a fictional overdue invoice and considers a reminder. This is not a captured PayPal operation. Read [the fictional console walkthrough](README.md#open-the-local-demo-console) for the available fields and simulated explanations.
3. **2:00–3:00 — A linked proposal.** In that example, a saved draft would belong to the selected invoice and have its own proposal ID. Read [the architecture](README.md#architecture) and [the proposal scene](VIDEO-SCRIPT.md) for the linkage. The script is a recording plan, not proof that footage exists.
4. **3:00–4:00 — Approval stays outside the model.** Read [operator approval](OPERATOR-APPROVAL.md): a person reviews the exact message in a separate interactive terminal. Approval expires after 15 minutes; content changes invalidate it. Saving a proposal or approving it alone sends nothing.
5. **4:00–5:00 — The recorded attempt and its limits.** Read [the architecture](README.md#architecture) and [validation evidence](VALIDATION.md). The executor persists an attempt before contacting PayPal; uncertain outcomes require reconciliation. A local result, invoice read or creation webhook does not establish recipient delivery.

The fictional example above is separate from the historical sandbox evidence in VALIDATION.md. It does not claim a newly executed end-to-end operation.

## Fictional evidence: due date versus contextual priority

Four unchanged fictional invoices from [the existing test fixture](tests/priority-explain.test.mjs), evaluated at 2026-10-28T12:00:00Z through the read-only tool dispatcher. This is deterministic policy output, not a live AI recommendation or PayPal verification.

| Invoice | Due-date rank | Tool rank | Returned explanation |
| --- | --- | --- | --- |
| early | 2 | 3 | Deadline has been reached or passed. Outstanding amount: 100.00 USD. Larger amounts rank first only after urgency and prior-reminder count tie. Previous reminders: 3. Within an urgency category, fewer prior reminders rank first. No open dispute was reported in the supplied snapshot. |
| selected | 3 | 1 | Deadline has been reached or passed. Outstanding amount: 500.00 USD. Larger amounts rank first only after urgency and prior-reminder count tie. Previous reminders: 0. Within an urgency category, fewer prior reminders rank first. No open dispute was reported in the supplied snapshot. |
| other | 4 | 2 | Deadline has been reached or passed. Outstanding amount: 100.00 USD. Larger amounts rank first only after urgency and prior-reminder count tie. Previous reminders: 0. Within an urgency category, fewer prior reminders rank first. No open dispute was reported in the supplied snapshot. |
| disputed | 1 | 4 | Deadline has been reached or passed. Outstanding amount: 100.00 USD. Larger amounts rank first only after urgency and prior-reminder count tie. Previous reminders: 0. Within an urgency category, fewer prior reminders rank first. An open dispute moves this invoice into manual review after invoices eligible for reminder review. |

The order changes: the open dispute goes to manual review; among eligible overdue invoices, fewer previous reminders come first, then larger outstanding amounts, then due date.

[Complete inputs and actual outputs](evidence/priority-vs-due-date.json). No credentials, API calls, proposal persistence, approvals, sends or server listeners were used. This fixture demonstrates policy behavior; business outcomes remain unmeasured.

## Recorded AI-client session

[Sanitized transcript](evidence/ai-client-session-20261103/TRANSCRIPT.md) of a real AI client (Claude Code) calling this MCP server against the PayPal sandbox on 2026-11-03. Only the four read-only tools were allowed; proposing and executing reminders were disabled for that session. Tool results are recorded outputs; the final recommendation is the model's own text.

## Option 2: executable walkthrough

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

## Hosted static demo

A browser-only version of the fictional console is published at <https://tienda.textokit.store/paypal-demo/>. No account, credentials, installation or commands are required.

- Every record and AI rationale on that page is fictional. No PayPal account or credentials are used.
- Filtering, sorting, previews and rejection run in the browser. The page makes no API calls.
- It embeds the fictional records from `src/console-demo-data.ts` and applies the same filtering and ordering as `/api/demo/queue`. Before publishing, four queries were checked against the compiled API.
- It does not connect to the PayPal sandbox. The sandbox integration is shown in the video and in Option 2 above.
- The Type and Item columns include AG Grid Community text filters (floating filter row). The status line shows displayed versus loaded rows, and a selection hidden by a filter is cleared so no hidden record stays actionable.
- The Type column uses a small AG Grid cell renderer: Dispute and Invoice appear as labeled badges built with textContent, while sorting and filtering keep the original values.
