# PayPal sandbox acceptance

Status: blocked by missing or invalid sandbox configuration. The last attempt performed no authenticated reads. Compilation and 50 local tests passed previously; genuine sandbox acceptance remains unverified.

## Configure locally

Supply these settings through the local process environment:

- PAYPAL_ENVIRONMENT=sandbox
- PAYPAL_CLIENT_ID: sandbox application client ID
- PAYPAL_CLIENT_SECRET: sandbox application secret
- PAYPAL_WEBHOOK_ID: sandbox webhook ID
- PAYPAL_DATABASE_PATH: persistent SQLite path shared with MCP and the operator approval command

Do not paste secrets into chat or commit them. The current loader reads process environment variables; it does not automatically load a .env file. Do not use production credentials.

## Verify authenticated reads

From the project directory, run:

```sh
node --experimental-strip-types src/sandbox-read-acceptance.ts
```

The command requests one dispute page and one invoice page, each with a limit of one. Its report omits credentials and response bodies. Preserve the report as separate acceptance evidence. Both checks must pass before recording sandboxReadsVerified=true. Empty successful pages establish access, but do not establish populated-data behavior.

The previous attempt is recorded in sandbox-reads-20261025T114411841469Z.json. Preserve that failed result. Repeat the command after configuration is supplied or corrected.

## Complete the remaining workflow

1. Start the MCP client using ../MCP-QUICKSTART.md and verify authenticated reads through MCP. The standalone read command does not establish MCP integration.
2. Create a proposal for an invoice controlled by the sandbox operator.
3. Have the human operator review and approve the exact proposal using ../OPERATOR-APPROVAL.md. Do not automate the operator's confirmation.
4. Execute that proposal through MCP before its approval expires. Record the attempt and verify the outcome in PayPal sandbox. Reconcile uncertain outcomes before further action.
5. Verify genuine webhook delivery through the configured receiver, including signature verification and durable deduplication. Local simulated tests alone do not establish this.

Keep authenticated reads, MCP integration, human approval, reminder execution, and webhook delivery as separate evidence. Full sandbox acceptance remains false until every required step has been verified.
