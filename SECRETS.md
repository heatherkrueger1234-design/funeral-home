# The secrets, and what each one costs

Every secret this deployment needs, how to make it, where it goes, what
breaks without it, and what it costs to lose it. **No value in this file is
real, and none ever may be.** Placeholders look like `<paste-yours-here>`.

Two rules before the table:

1. **Generate them on a machine you control**, not in a shared session, not
   in a chat window, not on a colleague's laptop. A secret that has been
   pasted into something that keeps history is a secret that has been
   published, and "I deleted the message" is not a recovery plan.
2. **`ENCRYPTION_KEY` is different from everything else here.** Every other
   secret on this page can be rotated by issuing a new one. That one cannot:
   it is the only thing standing between the ciphertext and the photographs.
   Read its section before you generate anything.

---

## The one that cannot be replaced

### `ENCRYPTION_KEY`

32 random bytes, base64. Encrypts every uploaded file and every social
security number, in the database **and in every backup**, with AES-256-GCM.

```sh
pnpm --filter @workspace/scripts run generate-encryption-key
```

| | |
| --- | --- |
| **Where it goes** | `.env` on the host. The API and the `tools` container both read it. |
| **Without it** | The stack refuses to start. Deliberately — a deployment that silently came up unable to decrypt its own files would be worse. |
| **If it leaks** | Every photograph and every SSN in the database and in every backup copy is readable by whoever has it. Treat as a breach; see below. |
| **If it is lost** | **The photographs are gone.** The ciphertext is still there and is worth nothing. There is no recovery, no vendor who can help, and no support ticket. Some of those files are the only copy a family has. |
| **Rotation** | Changing it does **not** re-encrypt anything. Existing files simply stop opening. There is no rotation procedure today; treat the value as permanent. |

**Where to keep the copy.** Somewhere that is neither this host nor the
backup, because the failure you are protecting against takes both. A password
manager the owner controls, plus a printed copy somewhere physically secure,
is enough and is not overkill. A copy in the same cloud account as the server
is not a second copy.

**If it is ever exposed:** the exposure is retroactive and covers every
backup ever taken, so there is no version of this that is only a
going-forward problem. There is no key-rotation path today, which means the
honest answer is: get help, tell the homes, and treat every backup as
readable. Write this down before it happens — see the incident plan line in
`LAUNCH.md`.

---

## The rest

| Secret | Make it with | Goes in | Without it | If it leaks |
| --- | --- | --- | --- | --- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` | `.env` | Stack refuses to start. | Only reachable inside the compose network — the port is not published — but it is in `DATABASE_URL`. Rotate: change `.env`, `ALTER USER … PASSWORD`, recreate the containers. |
| `TASK_SECRET` | `openssl rand -hex 32` | `.env` **and** the `TASK_SECRET` repository secret, identical | `/api/tasks/aftercare` returns 503 to everyone. That is deliberate: an unauthenticated endpoint that sends email is not a thing to leave open. **Aftercare silently never runs** — the feature the subscription is for. | A stranger can trigger grief check-ins. They cannot read anything. Rotate both sides together. |
| `SMTP_USER` / `SMTP_PASS` | From the mail provider | `.env` | Password resets, aftercare and intake alerts are **written to the API log instead of sent**. A director who forgets their password cannot get back in without somebody reading a server log. | Someone can send mail as the funeral home. Revoke at the provider — for Gmail, delete the app password. |
| `STRIPE_SECRET_KEY` | Stripe dashboard → API keys | `.env` | Nobody can subscribe. Homes work on trial until it runs out. | Full access to the Stripe account. Roll it in the dashboard immediately. Use a restricted key if you can. |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → the endpoint | `.env` | The webhook rejects everything, so **subscriptions never change state**: a home that pays stays on `trial`, a home that cancels keeps working. | Someone can forge subscription events and mark their own home paid. Roll it on the endpoint. |
| `TWILIO_AUTH_TOKEN` | Twilio console | `.env` | Directors copy the family link by hand. Degraded, not down. | Someone can send SMS on the account's bill. Roll it in the console. |
| `GOOGLE_PLACES_API_KEY` | Google Cloud console | `.env` | Vendor directory works from what the home types, and says "not configured" rather than pretending it found nothing. | Someone spends the quota. Restrict by API and referrer. |
| `ALERT_WEBHOOK` | Slack / PagerDuty / ntfy | Host env for `deploy/monitor.sh`, and the `ALERT_WEBHOOK` repository secret | **Nothing pages anybody.** `monitor.sh` refuses to run without it rather than pretend. | Someone can send you false alarms. Regenerate at the provider. |
| `HEARTBEAT_URL` | healthchecks.io etc. | Host env for `deploy/monitor.sh` | Nothing notices if the host stops running its checks entirely — the failure the on-host monitor can never report. | Someone can suppress a real alert by pinging it. Regenerate. |
| rclone remote credentials | The storage provider | `rclone.conf` on the host, path in `RCLONE_CONFIG` | No offsite backup. Dumps stay on the disk they are protecting. | Read and delete access to every backup — which is every photograph, encrypted. Use an application key scoped to the one bucket, and turn on the provider's object-lock or versioning so a stolen key cannot erase history. |

---

## Handling

- **`.env` is gitignored, and that is the only thing stopping it.** Check
  before every commit that you have not force-added it.
- **Never in a commit message, PR description, issue or CI log.** GitHub
  Actions masks registered secrets in output; it does not mask a value you
  pasted into a comment.
- **`chmod 600 .env` and `chmod 600 rclone.conf`.** Both sit on a host that
  may one day have somebody else's user account on it.
- **The repository secrets** (`TASK_SECRET`, `API_URL`, `ALERT_WEBHOOK`) are
  set under Settings → Secrets and variables → Actions. `FAMILY_DOMAIN` and
  `CONSOLE_DOMAIN` go under *Variables*, not Secrets — they are public
  hostnames and making them secrets only makes failures harder to read.
- **Backups contain everything except the key.** A backup file is not
  sensitive in the way the key is, but it is still every family's
  photographs in ciphertext. Keep them somewhere private anyway.

## When somebody leaves

Rotate, in this order, and in one sitting: `POSTGRES_PASSWORD`,
`TASK_SECRET`, SMTP, Stripe, Twilio, the rclone credentials, `ALERT_WEBHOOK`.
Then take a fresh backup and confirm `verify-backup` still passes against it.

`ENCRYPTION_KEY` is the one you cannot rotate, which is the real reason to be
careful about who it is shared with in the first place. Whoever has had it,
has it.
