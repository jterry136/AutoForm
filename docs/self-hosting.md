# Self-hosting

Everything you need to run your own AutoForm instance: clone → env → migrate → run
(FR-DOC-6).

This guide is for the person **operating** an instance. If you just want to point a form at
an instance that already exists, read [getting started](getting-started.md) instead.

---

## 1. Prerequisites

| You need | Why |
|---|---|
| **Node 24 or newer** + npm | The project is built and tested on Node 24 (see `.github/workflows/ci.yml`). |
| **A Postgres database** | All state lives here. Supabase's free tier is the reference target, but any Postgres works. |
| **Docker** *(optional)* | Only to run the test suite — the integration tests start a throwaway Postgres container. Not needed to run the app. |
| **A Resend account** *(optional)* | Only if you want the email connector. The webhook connector needs nothing. |

### A note on Supabase connection strings

If you use Supabase, take the **Transaction pooler** URL (Dashboard → Project → Connect →
ORMs → Drizzle), not the direct connection. The pooler does not support prepared
statements, so the Drizzle client is already configured with `prepare: false`
(`src/db/index.ts`) — you don't need to change anything, just use the pooled URL.

Any other Postgres (local, RDS, Neon, a container) works with its ordinary connection
string.

---

## 2. Clone and install

```bash
git clone https://github.com/jterry136/AutoForm.git
cd AutoForm
npm install
```

---

## 3. Configure the environment

```bash
cp .env.example .env
```

AutoForm reads five environment variables. They are validated at startup by
`src/lib/env.ts` (ArkType) — the process **fails fast with a clear message** if a required
one is missing, rather than half-booting.

| Variable | Required | What to put in it |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (Supabase: the Transaction pooler URL). |
| `BETTER_AUTH_SECRET` | yes | Random secret used to sign sessions. |
| `BETTER_AUTH_URL` | yes | The **public origin** of your instance, e.g. `https://forms.example.com`. `http://localhost:3000` in development. |
| `ENCRYPTION_KEY` | yes | 32 random bytes, base64-encoded. Encrypts destination credentials at rest (AES-256-GCM). |
| `RESEND_API_KEY` | no | Resend API key. Only needed for the email connector. |

Blank values are treated as unset, so leaving `RESEND_API_KEY=` in `.env` is the same as
omitting it — a required variable left blank still fails.

### Generating the secrets

```bash
# BETTER_AUTH_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY — must decode to exactly 32 bytes
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

> **Keep `ENCRYPTION_KEY` safe and stable.** Destination credentials in the database are
> encrypted with it. Lose it and every stored credential becomes unreadable; rotate it
> carelessly and deliveries start failing. See [key rotation](#key-rotation) below.

`.env` is gitignored. Never commit real secrets.

---

## 4. Create the schema

Apply the migrations that ship with the repo:

```bash
npm run db:migrate
```

Drizzle Kit reads `DATABASE_URL` from the **process** environment (`drizzle.config.ts`). If
your shell doesn't already export it, load `.env` explicitly:

```bash
node --env-file=.env ./node_modules/.bin/drizzle-kit migrate
```

Related commands:

| Command | When |
|---|---|
| `npm run db:generate` | You changed `src/db/schema.ts` and need a new migration. Never hand-write SQL. |
| `npm run db:migrate` | Apply pending migrations (first install, and after every upgrade). |
| `npm run db:studio` | Browse the data in Drizzle Studio. |

---

## 5. Run it

### Development

```bash
npm run dev     # http://localhost:3000
```

The Vite config loads `.env` into `process.env` for you (real environment variables win
over `.env` values), so the dev server picks up your local config with no extra flags.

### Production

```bash
npm run build   # outputs .output/
npm start       # node .output/server/index.mjs
```

**`npm start` is plain Node — it does not read `.env`.** Supply the variables the way your
host does it (a dashboard, a systemd unit, a container env file), or load the file
explicitly:

```bash
node --env-file=.env .output/server/index.mjs
```

The build itself does not need a database; only the running server does.

Then open your instance, sign up at `/signup`, and follow
[getting started](getting-started.md) to create your first form.

---

## 6. How the delivery worker runs

**The delivery worker is in-process.** There is no separate worker process, no Redis, no
external broker (see [DECISIONS.md](../DECISIONS.md) D-006). The custom server entry
`src/server.ts` calls `ensureDeliveryWorker()` (`src/lib/worker.ts`) once at boot, which
starts a polling loop over the `delivery_attempt` table.

This keeps self-hosting to a single process, but it has consequences worth knowing before
you pick a host:

- **No `DATABASE_URL`, no worker.** `ensureDeliveryWorker` logs
  `[delivery-worker] DATABASE_URL not set — worker not started.` and returns. The app still
  boots; deliveries simply never move.
- **The worker lives and dies with the web server.** It is started from the server entry,
  so it only runs while a server process is running.
- **A sleeping or scaled-to-zero instance does not deliver.** The poller is `unref`'d — it
  never keeps the process alive on its own. On hosts that suspend or freeze an idle app,
  queued submissions simply wait until the process is running again. **Nothing is lost**
  (every accepted submission is persisted before any delivery attempt — P-5), but delivery
  is delayed. If timely delivery matters, run AutoForm as a long-lived process (a
  container, a VM, or any always-on Node host) rather than on a scale-to-zero platform.
- **Multiple instances are safe, but each one polls.** Attempts are claimed with
  `SELECT … FOR UPDATE SKIP LOCKED`, so two workers pull disjoint batches and never deliver
  the same attempt twice. Running N app instances just means N pollers sharing the queue.
- **A crashed worker recovers itself.** An attempt left in `processing` with a stale lock
  (older than 60s) is returned to `pending` by whichever worker notices first, without
  counting as a failed try.
- **The tunables are constants, not environment variables.** Poll interval (1s), batch size
  (10), max attempts (5), exponential backoff (2s base, capped at 5min, with jitter), and
  the stale-lock window (60s) all live at the top of `src/lib/queue.ts`. Changing them means
  editing and rebuilding.

### Rate limiting is also per-process

Spam rate limiting is an in-memory, fixed-window limiter (`src/lib/spam.ts`, D-009). It is
**per instance**: run three instances behind a load balancer and a client effectively gets
three times the configured budget. Single-instance deployments — the expected shape for
self-hosting — are unaffected.

### Retention purge

Configurable retention (a purge pass for expired submissions) is planned for Phase 2 and is
**not in this release**. When it lands it will run in the same in-process model described
above, with the same consequence: an instance that isn't running isn't purging. This section
will be updated then.

---

## 7. Deployment notes

**Put it behind HTTPS.** Sessions are cookie-based and submissions carry user-entered
content. Terminate TLS at a reverse proxy (nginx, Caddy, Traefik) or at your platform's
edge, and proxy to the Node process.

**Set `BETTER_AUTH_URL` to the public origin.** It is the base URL Better Auth uses for
session cookies and redirects. If it disagrees with the URL people actually visit, login
will misbehave in confusing ways. `https://forms.example.com`, not `http://localhost:3000`,
not an internal container hostname.

**Forward the client IP.** Rate limiting reads `x-forwarded-for` (first entry), then
`x-real-ip`. If your proxy doesn't set one of these, every submission looks like it comes
from the same address and per-IP limits will be wrong. In nginx:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Real-IP $remote_addr;
```

**The ingestion endpoint must be publicly reachable.** `POST /f/{formId}` is the whole
point: browsers on other people's sites post to it directly. It is unauthenticated by
design — security comes from the unguessable form ID plus the honeypot and rate limiting —
and it responds with permissive CORS headers so cross-origin form and AJAX posts work. Do
not put it behind an allowlist, VPN, or auth proxy; if you firewall the app, the dashboard
routes can be restricted but `/f/*` cannot.

**Give it a real domain.** Embed codes generated by the dashboard contain the endpoint URL,
so the origin your users' forms point at is the one you configure. Changing hosts later
means re-issuing embed codes.

---

## 8. Connector prerequisites

A connector needs whatever its destination needs — nothing more.

| Connector | Server-side prerequisite |
|---|---|
| **Webhook** | None. Works out of the box on any instance. |
| **Email (Resend)** | `RESEND_API_KEY`. Without it, adding an email destination is rejected at configuration time with `RESEND_API_KEY is not configured on the server.`, and any already-configured email delivery fails non-retryably (straight to dead-letter) with the same message — never a silent drop. |

For production email, verify a sending domain in Resend and set the destination's `from` to
an address on it. The default sender is Resend's shared test address, which is fine for
trying things out and not for real traffic.

Slack, Airtable, and CAPTCHA are planned for later phases and are **not shipped**; they
require no configuration today. See [connectors.md](connectors.md) for per-connector config
and retry behavior.

---

## 9. Backups and upgrades

### What to back up

**The database is the only state.** There is no local file storage, no uploads directory,
no cache that matters. Back up Postgres (Supabase does daily backups on managed projects;
otherwise `pg_dump` on a schedule).

**Back up `ENCRYPTION_KEY` separately from the database**, somewhere you can still reach it
if you lose the host — a password manager or your platform's secret store. A database dump
without the key still restores your forms and submissions, but every destination credential
in it is unrecoverable and must be re-entered by hand. `BETTER_AUTH_SECRET` matters less:
losing it only invalidates existing sessions, and everyone logs in again.

### Key rotation

Encrypted values carry a version prefix (`v1:…`), so rotation is additive rather than a
flag day: add the new key to the registry in `src/lib/crypto.ts`, point `CURRENT_VERSION` at
it, and keep the old key so existing rows still decrypt. New writes use the new key; old
rows keep working until they're rewritten. **Do not simply swap `ENCRYPTION_KEY` for a new
value** — existing credentials were encrypted under `v1` and will fail to decrypt at
delivery time.

### Upgrading

```bash
git pull
npm ci                # matches package-lock.json exactly
npm run db:migrate    # apply any new migrations
npm run build
# restart the server process
```

Run `npm run db:migrate` on **every** upgrade — a release may add columns or tables. There
is a brief window during a restart when the app is down; in-flight deliveries are not lost
(a claimed attempt whose lock goes stale is reclaimed automatically).

---

## 10. When deliveries aren't moving

Work down this list:

1. **Is the worker running?** Look for `[delivery-worker] started (worker=…)` in the server
   logs at boot. If instead you see `DATABASE_URL not set — worker not started`, the process
   is missing its environment (the most common cause is `npm start` without `--env-file`).
2. **Is the process actually up?** On a host that sleeps or scales to zero, nothing polls.
   See [section 6](#6-how-the-delivery-worker-runs).
3. **Was the submission accepted at all?** Check the form's inbox in the dashboard. If the
   submission isn't there, the problem is at ingestion — the honeypot was tripped, the
   payload failed validation against the form definition, or the request was rate-limited —
   not at delivery.
4. **Does the form have a destination?** A form with none stores submissions and delivers
   nothing. That's by design, and easy to overlook.
5. **What does the delivery status say?** The inbox shows every attempt with its status,
   attempt number, error, and response status.
   - `pending` → queued, and waiting out a retry backoff if this isn't the first attempt.
   - `failed` → a retryable failure; a fresh `pending` attempt has already been queued.
   - `dead_letter` → terminal. Either the destination returned a permanent error (bad
     credentials, an invalid recipient, a 4xx) or all 5 attempts were used. The recorded
     `error` says which.
   - For the fields the dashboard doesn't surface — `next_run_at` (when a retry is due) and
     the truncated `response_body` — query the `delivery_attempt` table directly, e.g. with
     `npm run db:studio`.
6. **Check the server logs** for `[delivery-worker] tick failed:` — that indicates the loop
   itself is erroring (typically a database connectivity problem), not an individual
   destination.

---

## See also

- [Getting started](getting-started.md) — using an instance, from signup to a live form.
- [Form fields](form-fields.md) — the form-definition reference.
- [Connectors](connectors.md) — webhook and email configuration and retry semantics.
- [DECISIONS.md](../DECISIONS.md) — why the queue, worker, and crypto work the way they do.
