# Demo video script

Target runtime: 2 minutes 40 seconds. Narration and captions are in English.

This is a recording plan, not evidence of completed acceptance. Record genuine PayPal and Claude scenes only after verification. Interim footage must visibly say ‘Simulated data — sandbox integration pending.’ Never display credentials or customer information. Verify browser interaction before recording the console.

## Scene 1 — The problem | 0:00–0:20

**Screen:** Fictional disputes, unpaid invoices, and a reminder draft.

**Voiceover:** ‘Payment operations mean reviewing disputes, tracking unpaid invoices, and deciding when to follow up. An assistant can organize the work, while contacting a customer remains a deliberate human decision.’

## Scene 2 — Verified webhook intake | 0:20–0:45

**Screen:** PayPal webhook → signature verification → SQLite. Show genuine sanitized delivery and deduplication evidence only after acceptance; otherwise label the architecture illustration.

**Voiceover:** ‘The receiver asks PayPal to verify the event signature before storing it. Durable deduplication prevents repeated deliveries from creating duplicate event records.’

## Scene 3 — AG Grid demo queue | 0:45–1:05

**Screen:** Open http://127.0.0.1:8790. Keep the simulation notice visible. Show deadline ordering and invoice and overdue filters. Select an invoice and prepare its draft using the approval-instructions button. Show the returned proposal ID and exact note. Briefly reject another demo item. Caption: ‘Draft saved; no approval or send. Rejection hides a row for this session.’

**Voiceover:** ‘The AG Grid demo orders fictional items by deadline, with filters and simulated explanations. Selecting an invoice saves a reminder draft for terminal review. Retrying retrieves the same proposal. Reject hides a row for this browser session.’

## Scene 4 — Claude through MCP | 1:05–1:35

**Screen:** After verifying the genuine connection, request `list_unpaid_invoices` in Claude. Choose an operator-controlled sandbox invoice and use `propose_invoice_reminder`. Show the proposal ID and exact note. Use the sandbox database, separate from the fictional console database. Until verification, show a labeled architecture illustration.

**Voiceover:** ‘Claude connects through MCP to retrieve sandbox invoices and prepare proposals. Creating a proposal stores a draft; it does not authorize sending. The fictional console uses a separate database.’

## Scene 5 — Separate human approval | 1:35–2:05

**Screen:** A human opens the existing approval CLI for the selected proposal using its corresponding database. Show the invoice and complete note, then the human's confirmation. Caption: ‘Approval expires after 15 minutes; approval alone sends nothing.’ If using a demo proposal, keep it visibly labeled fictional. Never automate the human confirmation.

**Voiceover:** ‘The operator reviews the exact proposal in a separate local terminal. MCP has no approval tool. Changing the proposal invalidates authorization. Even with approval, the demo console cannot send a reminder.’

## Scene 6 — Controlled execution | 2:05–2:25

**Screen:** Only after genuine acceptance, request `execute_invoice_reminder` for the human-approved sandbox proposal. Show the controlled outcome and persisted attempt, with recipient details hidden. Otherwise show the demo endpoint's rejection with a simulation caption.

**Voiceover:** ‘Sandbox execution checks approval and records an attempt before contacting PayPal. An existing attempt blocks another execution of that proposal. Uncertain outcomes require reconciliation.’

## Scene 7 — Evidence and next steps | 2:25–2:40

**Screen:** Show the recorded successful build and regression suite, including the console API test. Keep browser verification and genuine PayPal acceptance marked pending until separately verified.

**Voiceover:** ‘The build and local regression suite passed, including persistent drafts, retry behavior, and execution rejection. Browser verification remains pending. Genuine PayPal sandbox acceptance awaits credentials.’
