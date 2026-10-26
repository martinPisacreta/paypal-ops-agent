# Sandbox webhook deployment

The supplied systemd template runs the receiver on 127.0.0.1:8787.

## Configuration

Run commands from the project root. Create `./.env` privately with your sandbox settings:

```ini
PAYPAL_CLIENT_ID=YOUR_SANDBOX_CLIENT_ID
PAYPAL_CLIENT_SECRET=YOUR_SANDBOX_CLIENT_SECRET
PAYPAL_WEBHOOK_ID=YOUR_SANDBOX_WEBHOOK_ID
```

Use systemd EnvironmentFile syntax, without shell commands or variable expansion. Restrict this file with `chmod 600 .env`. Never commit credentials. Automatic environment-file loading by the application is not implemented; systemd supplies these settings.

The unit sets `PAYPAL_ENVIRONMENT=sandbox`, `PAYPAL_DATABASE_PATH=./data/operations.sqlite` and port 8787. The database path resolves from the project root, and the receiver creates its directory. Start the MCP server and approval CLI from that same directory with the same database setting when sharing a workflow. The receiver only verifies and stores webhook events.

## Installation

Requires Linux with systemd, Node.js 22.23.3 or later, installed dependencies and a completed build. Ensure `node` is available in the system service PATH.

Systemd requires absolute paths for WorkingDirectory and EnvironmentFile. The template uses `@PROJECT_ROOT@`; generate an installation copy from your checkout location rather than editing the template. These POSIX shell commands use a temporary directory outside the project:

```sh
unit_dir=$(mktemp -d)
python3 - "$unit_dir/paypal-webhook.service" <<'PY'
from pathlib import Path
import sys

root = str(Path.cwd().resolve())
if '\n' in root or '\r' in root:
    raise SystemExit('Unsupported project path')
root = root.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34)).replace('%', '%%')
template = Path('deploy/paypal-webhook.service').read_text(encoding='utf-8')
Path(sys.argv[1]).write_text(template.replace('@PROJECT_ROOT@', root), encoding='utf-8')
PY
```

Validate the generated unit before installing it. Run installation commands with appropriate administrator privileges:

```sh
systemd-analyze verify "$unit_dir/paypal-webhook.service"
install -m 0644 "$unit_dir/paypal-webhook.service" /etc/systemd/system/paypal-webhook.service
systemctl daemon-reload
systemctl enable --now paypal-webhook.service
```

If you move the checkout, regenerate and reinstall the unit. Keep the credentials file readable only by the intended service operator.

## Outbound proxy

A systemd service does not inherit an interactive shell's environment. If the host reaches the internet through a proxy, the service needs those variables too: the receiver calls PayPal for OAuth and `verify-webhook-signature` on every delivery. Without them, deliveries arrive but are answered 503 and nothing is stored. One way is a drop-in such as `/etc/systemd/system/paypal-webhook.service.d/proxy.conf`:

```ini
[Service]
EnvironmentFile=/etc/environment
```

Then run `systemctl daemon-reload` and `systemctl restart paypal-webhook.service`. Keep proxy credentials private.

## HTTPS and acceptance

Configure an HTTPS reverse proxy to forward `/webhooks/paypal` to `http://127.0.0.1:8787/webhooks/paypal`, preserving the body and PayPal signature headers. Register that HTTPS URL with the same sandbox application and use its webhook ID in the environment file.

Validate a genuine sandbox webhook and its redelivery. Confirm that one event is retained across receiver restarts. Missing or invalid signatures must be rejected. A running process or simulated test alone does not establish sandbox acceptance. Installation and service startup remain unverified.

## Stop

```sh
systemctl disable --now paypal-webhook.service
```

Stopping the receiver preserves its database.
