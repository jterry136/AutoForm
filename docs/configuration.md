# Configuration — environment variables

The canonical reference for every environment variable AutoForm reads (FR-DOC-6). This
is the one place variables are documented; `README.md` links here rather than repeating
the table.

**The contract is code.** `src/lib/env.ts` holds the ArkType schema that validates the
environment, plus an `ENV_VARS` table describing each variable. A unit test
(`src/lib/env.unit.test.ts`) asserts that the schema, `.env.example`, and the table below
all agree on names and requiredness — so this page cannot silently drift from the code.

## Quick start

```bash
cp .env.example .env
```

Then fill in the four required variables below. `.env` is gitignored — never commit real
secrets. In development, Vite loads `.env` into `process.env` (see `vite.config.ts`); in
production, set real environment variables in your host — real env vars take precedence
over `.env` file values.

## Reference

| Variable | Required | Missing → | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **Yes** | startup-fatal | Postgres connection string (Supabase). All storage: forms, submissions, delivery queue. |
| `BETTER_AUTH_SECRET` | **Yes** | startup-fatal | Signing secret for Better Auth sessions. |
| `BETTER_AUTH_URL` | **Yes** | startup-fatal | Public base URL of this instance; Better Auth builds callback/cookie URLs from it. |
| `ENCRYPTION_KEY` | **Yes** | startup-fatal | AES-256-GCM key encrypting destination credentials at rest (P-2, D-004). |
| `RESEND_API_KEY` | No | email delivery fails | Resend API key used by the email connector. Absent → email destinations dead-letter. |
| `MAIL_FROM` | No | test sender used | Sender identity for AutoForm's own platform mail (delivery-failure alerts). Absent → Resend's onboarding sender. |
| `DELIVERY_HEALTH_THRESHOLD` | No | defaults to 3 | Consecutive dead-lettered deliveries before a destination is flagged unhealthy (D-010). |
| `DELIVERY_HEALTH_COOLOFF_MINUTES` | No | defaults to 1440 | Minimum gap, in minutes, between two alerts about the same destination (D-010). |
| `RETENTION_PURGE_INTERVAL_MS` | No | defaults to hourly | How often the age-based retention purge pass runs (D-011). Clamped to a 60000 floor. |

"Startup-fatal" means `src/lib/env.ts` throws when the variable is absent or empty, and
any server code path that imports it (database, auth, connectors) fails with a message
naming the offending variable. Validation runs on first import of that module, so a fully
unconfigured dev server can still boot a static page — but every real feature will fail.

---

### `DATABASE_URL`

- **Format:** `postgresql://USER:PASSWORD@HOST:PORT/DATABASE`
- **Where to get it:** Supabase Dashboard → Project → **Connect** → **ORMs (Drizzle)**.
  Use the **Transaction pooler** URL; the Drizzle client sets `prepare: false`
  (`src/db/index.ts`) for pooler compatibility.
- **Also read outside the schema:** `drizzle.config.ts` (migrations) and `src/lib/worker.ts`
  (worker start gate). When invoking Drizzle Kit, make sure the variable is exported or
  loaded (e.g. `node --env-file=.env`).
- **When missing:** every DB path fails, and the in-process delivery worker logs
  `[delivery-worker] DATABASE_URL not set — worker not started.` and stays off. Nothing is
  delivered.

### `BETTER_AUTH_SECRET`

- **Format:** a high-entropy string. Generate one with:
  ```bash
  openssl rand -base64 32
  ```
- **When missing:** authentication is unusable — no sign-up, sign-in, or dashboard access.
- **Rotating it invalidates every existing session** (users must sign in again).

### `BETTER_AUTH_URL`

- **Format:** the instance's public origin, no trailing slash — `http://localhost:3000`
  in development, `https://forms.example.com` in production.
- **When missing:** startup-fatal. When *wrong*, auth appears configured but redirects and
  cookies point at the wrong origin, so sign-in silently fails behind a proxy or custom
  domain. Set it to the URL users actually reach.

### `ENCRYPTION_KEY`

- **Format:** exactly **32 bytes, base64-encoded** (AES-256). Generate one with:
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  ```
  A key of any other length throws at startup with the expected length in the message.
- **When missing:** startup-fatal — destination credentials can be neither stored nor
  decrypted, so no delivery to an authenticated destination can happen.
- **Treat as unrecoverable.** Stored credentials are tagged with the key version that
  encrypted them (`v1:…`). Losing or replacing the key makes existing credentials
  undecryptable — owners must re-enter them. To rotate properly, add the new key under a
  new version in `src/lib/crypto.ts` and keep the old one so existing rows still decrypt
  (D-004).

### `RESEND_API_KEY`

- **Format:** a Resend API key (`re_…`), from <https://resend.com/api-keys>.
- **Optional, feature-disabling.** Everything except the email connector works without it.
- **When missing:** creating an email destination is rejected at configuration time
  (`validateConfig`), and any email delivery attempt fails **non-retryably** — the attempt
  goes straight to `dead_letter` rather than retrying. It is not "email is hidden": the
  destination type is still offered, it just cannot deliver. Set the key before pointing a
  form at email.
- App-level, not per-destination: one key serves every email destination on the instance.

### `MAIL_FROM`

- **Format:** an RFC 5322 sender, e.g. `AutoForm <notifications@example.com>`.
- **Optional.** Sets the From address for AutoForm's **own** mail — delivery-failure alerts —
  which is not the same thing as the email connector's destination mail.
- **When missing:** Resend's onboarding sender is used. That works for testing but is not
  deliverable to arbitrary recipients, so set a verified domain before relying on alerts.

### `DELIVERY_HEALTH_THRESHOLD`

- **Format:** a positive integer. **Default:** `3`.
- **Optional.** How many consecutive dead-lettered deliveries flag a destination as
  unhealthy (D-010). A `failed` attempt that still has a retry queued does not count.
- **When missing:** the default applies; detection still runs.

### `DELIVERY_HEALTH_COOLOFF_MINUTES`

- **Format:** a positive integer, in minutes. **Default:** `1440` (24 hours).
- **Optional.** The suppression window between two alerts about the same destination, so a
  sustained outage does not mail the owner repeatedly (D-010).
- **When missing:** the default applies.

### `RETENTION_PURGE_INTERVAL_MS`

- **Format:** a positive integer, in milliseconds. **Default:** `3600000` (hourly).
- **Optional.** How often the age-based retention purge pass sweeps for submissions past
  their form's window (D-011). Values below `60000` are clamped to one minute.
- **When missing:** the default applies. The pass only runs while an app instance is
  running, so retention is "kept for *at least* N days", not a hard deletion deadline.

## Not environment variables

Things self-hosters look for and will not find:

- **Delivery worker and retry tuning** — poll interval, batch size, max attempts, backoff
  bounds and the stale-lock window are compile-time constants in the `Tunables` block at
  the top of `src/lib/queue.ts`. Change them there and redeploy; there are no env knobs
  for them. (The retention purge cadence *is* configurable — see
  `RETENTION_PURGE_INTERVAL_MS` above — but its batch sizes are constants in the same
  style, in `src/lib/retention-purge.ts` and `src/lib/purge.ts`.)
- **Rate limits** — the per-IP window lives in `src/lib/spam.ts`; the per-form allowance is
  the form's own `rateLimitPerMinute` column, set per form, not per instance.
- **Connector OAuth and CAPTCHA credentials** — Slack/Airtable OAuth client pairs and
  Turnstile keys belong to connectors that are **not built yet** (Phase 1/2). No code reads
  them today. Do not add them to `.env` until the connector that consumes them ships and
  this page lists it.

## Runtime variables owned by the host

Read by the Node/Nitro server or tooling rather than by AutoForm code, so they are not in
the schema and not in `.env.example`:

- **`PORT`** — port for the production server (`npm start` → `node .output/server/index.mjs`).
  The dev server's port is fixed at 3000 by `vite.config.ts`, not by this variable.
- **`NODE_ENV`** — set by the build/run tooling; do not set it by hand in `.env`.

## Tests

`npm test` does not read your `.env`. `vitest.config.ts` injects its own values —
`DATABASE_URL` pointing at the throwaway Docker Postgres started in `test/global-setup.ts`,
a random `ENCRYPTION_KEY`, and placeholder Better Auth values. Tests never touch a real
Supabase project, and CI needs no secrets.

## Adding a variable

Change all three together, or the parity test fails:

1. `src/lib/env.ts` — add it to the ArkType schema **and** to `ENV_VARS`.
2. `.env.example` — add the key with a comment (blank value; never a real secret).
3. This page — add a row to the reference table and a section describing it.
