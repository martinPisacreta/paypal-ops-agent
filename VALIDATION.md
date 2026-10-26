# Sandbox validation

Everything below ran against the PayPal sandbox with fictional records. No real customer or payment was involved.

## MCP reads — 25 October 2026

A real MCP client listed disputes and unpaid invoices through the official APIs (`src/mcp-read-acceptance.ts`; notes in `acceptance/MCP-READS.md`).

## Human-approved reminder — 25 October 2026

- The operator reviewed and approved the exact reminder for fictional invoice `INV2-RNWZ-5LKH-446E-ZJEU` in the interactive terminal (approval `716bdb5e-e5bc-4b4c-a131-aab01f896e13`).
- The MCP executor sent proposal `24d9d6ca-e3d2-4d78-af9b-86d038cff8d1` once and returned `succeeded` (attempt `0700a7d4-bc75-4f46-a383-4c62a1b29cd5`).
- A later read of the invoice returned HTTP 200 and status `UNPAID`. No retry was performed. Recipient delivery was not independently checked.

## Genuine webhook delivery — 26 October 2026

- The webhook was registered on the sandbox application for a public HTTPS URL with six event types (`scripts/register-webhook.mjs`). Its ID is kept only in `.env`.
- The receiver ran as a systemd service bound to `127.0.0.1`, behind an HTTPS reverse proxy that forwards only `Content-Type` and `PayPal-*` headers.
- A fictional draft invoice, `INV2-2CT3-LJ5C-6V5V-THW8`, was created and never sent (`scripts/create-webhook-test-invoice.mjs`). PayPal emitted event `WH-3XV622159K8539546-6A7782432N544713P` (`INVOICING.INVOICE.CREATED`).
- The first delivery, at 08:51:46 UTC, received HTTP 503. The service had not loaded the host's outbound proxy settings, so `verify-webhook-signature` could not be reached. Nothing was stored, as designed.
- After the proxy environment was added to the service (see `deploy/README.md`), PayPal retried at 08:59:45 UTC. The signature was verified with PayPal and the event was stored: HTTP 200, one row.
- A resend requested through `POST /v1/notifications/webhooks-events/{id}/resend` arrived at 09:12:54 UTC with a new transmission ID. The receiver answered HTTP 200 and the inbox still held exactly one row for the event.
- An unsigned POST to the public URL returns HTTP 400.

## Tests

`npm run build` and `npm test` passed with 56 of 56 tests on 26 October 2026, after the changes above.
