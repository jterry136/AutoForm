# DECISIONS.md — AutoForm

A running log of **impactful, project-wide design decisions** — the "this is how we do
things" calls, not routine "which library" picks. Each entry is short and high-level: the
decision, why, and what it implies. Newest at the top.

> When you make a decision of this kind, **add an entry here** and reflect any operational
> rule it implies in [CLAUDE.md](CLAUDE.md). Tech-stack picks live in CLAUDE.md's stack
> table; this file is for cross-cutting principles and policies.

---

## D-016 — Post-submit redirect is same-origin-by-default, off-site only when registered

**Date:** 2026-08-20 · **Status:** Accepted · **Covers:** FR-EMB-2, NFR-SEC-4/5

**Decision.** `resolveRedirectTarget` (`src/lib/validation.ts`) is the single place the
post-submit redirect target (`_redirect`) is resolved, called from `ingestSubmission` on
every path that returns one — including the silently-rejected honeypot path, so a bot and a
real submitter see the same response shape. The rule:

- A same-origin **relative path** (`/thanks`, not `//host/thanks`) is always honored.
- An **absolute `http(s)` URL** is honored only when its origin matches the form's own
  `redirectUrl` column — the destination the form owner has registered for this form.
- Anything else — a different origin, `javascript:`/`data:`/another scheme, a malformed
  value — is ignored. The response falls back to the registered `redirectUrl` if there is
  one, otherwise the hosted `/success` page. `_redirect` never wins over the registered
  value; it can only narrow to a same-origin path under it.

**Rationale.** `POST /f/{formId}` is public and intentionally unauthenticated (self-hosting
docs — it must accept posts from any site's embed). That means `_redirect` in the request
body is attacker-controlled: anyone can POST directly to a discoverable form ID with
`_redirect=https://phish.example` and get an instant, silent 303 off AutoForm's own trusted
domain — an open-redirect/phishing primitive, and one of the two most severe findings (the
other being the webhook connector's SSRF, fixed separately) of a pre-deployment security
audit. Restricting to the form owner's own registered origin closes this while preserving
the documented (FR-EMB-2, Must)
ability to redirect off-site to the owner's own thank-you page — the owner just has to
register that origin once, rather than trusting whatever value shows up in a given POST.

**Implications.**
- Until a dashboard UI exists to set `redirectUrl` (it doesn't yet — the column exists but
  has no write path today), off-site `_redirect` has no way to be honored in practice; only
  relative paths work. This is a known, deliberate gap, not a workaround to remove later —
  building that UI is a separate product feature, not part of this fix.
- `formRow.redirectUrl` itself is re-validated as an http(s) URL before being used as either
  the trust anchor or the fallback target — a bad value reaching that column by some other
  path (e.g. a future admin tool bug) can't produce an unsafe redirect either.
- Any future code path that resolves a redirect target from form-adjacent data must go
  through `resolveRedirectTarget`, not re-derive its own scheme/origin check.

---

## D-014 — One canonical environment reference, kept honest by a parity test

**Date:** 2026-08-17 · **Status:** Accepted · **Covers:** FR-DOC-6 · **Constraint:** C-2

**Decision.** Environment variables are documented in exactly **one** place —
[docs/configuration.md](docs/configuration.md). The README links to it and no longer
carries its own table. Three artifacts describe the same set of variables:

- **`src/lib/env.ts`** — the ArkType schema (the contract), plus an exported `ENV_VARS`
  table recording each variable's requiredness and what its absence costs.
- **`.env.example`** — the template, one blank key per variable.
- **`docs/configuration.md`** — the prose reference.

`src/lib/env.unit.test.ts` asserts they agree: names match in all three, requiredness in
the docs matches the schema's behaviour, every variable has a section, and no secret value
is committed to `.env.example`.

Each variable is additionally classified as **startup-fatal** (absence throws on first
import of `env.ts` — `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`,
`ENCRYPTION_KEY`) or **feature-disabling** (`RESEND_API_KEY`: only the email connector
stops working, and its failures are non-retryable rather than silent).

**Rationale.** A self-hosting guide is only worth reading if it matches the code, and a
duplicated table drifts the moment someone adds a variable — `ENCRYPTION_KEY` was already
required by the schema but absent from `.env.example`, so copying the template produced an
instance that could not boot. Prose alone cannot prevent that recurring; a test can. C-2
makes this load-bearing: an outside contributor's first hour is spent on configuration.

**Implications.**
- **Adding or removing a variable is a three-file change** — schema + `ENV_VARS`,
  `.env.example`, `docs/configuration.md` — and the test fails until all three land.
- Documenting a variable no code reads is a **failure**, not harmless hedging. Credentials
  for unbuilt connectors (Slack/Airtable OAuth, Turnstile) are named in a "not
  environment variables" section instead, so nobody sets them expecting an effect.
- Values the *host* owns (`PORT`, `NODE_ENV`) are called out separately and stay out of the
  schema and `.env.example`.
- Compile-time tunables (worker poll interval, retry bounds, rate-limit window) are
  documented as **not** configurable via env, pointing at the constants instead. Promoting
  one to an env var means following the three-file rule.

---

## D-013 — Delivery-health notifications: per-form opt-out, dashboard always tells the truth

**Date:** 2026-08-18 · **Status:** Accepted · **Covers:** FR-NOTIF-1, NFR-OBS-1,
NFR-A11Y-1/2 · **Builds on:** D-010 (detection), D-008 (ownership-scoped data layer)

**Decision.** Detection (D-010) emits a signal; **`src/lib/delivery-notifications.ts` is
the only place that turns one into mail.** It resolves the destination's form and
owner-facing names, applies the rules below, and calls the system mailer
(`src/lib/mailer.ts`). It is injected at the worker boundary — the delivery queue still
never imports a mail provider.

1. **Opt-out is per form, and covers the email only.** `form.delivery_health_emails`
   (default true) suppresses the mail. Detection, the persisted health state, and the
   dashboard badge are unaffected, so turning notifications off quiets the mailbox without
   blinding the owner. No unsubscribe link: the mail goes to the owner's account address,
   and the authenticated toggle is the way to stop it.
2. **Recovery is never emailed.** The `recovered` signal clears the dashboard badge and is
   logged. An owner who has just fixed a destination does not need a second message saying
   they fixed it.
3. **The dashboard is the always-on surface.** A flagged destination shows a badge and an
   inline explanation on the form page, carried by an icon and the word "Failing" rather
   than by colour (WCAG 2.1 AA 1.4.1). A healthy destination shows nothing — only a
   problem draws the eye.
4. **Notification failure is never delivery failure.** Every path through the bridge
   returns a structured outcome instead of throwing, layered on top of the detection pass
   already swallowing its own errors.

**Rationale.** The obvious alternative — a global per-account preference — is the wrong
grain: an owner running one noisy internal webhook alongside a customer-facing form wants
to mute the first without going deaf on the second. Scoping the opt-out to the *email*
rather than to detection means the state stays correct while the owner is not listening,
so the dashboard is trustworthy the moment they come back to it. Keeping the bridge in its
own module leaves detection unaware of mail and mail unaware of the queue, which is what
makes both testable with a fake.

**Implications.**
- Adding a second notification channel (Slack, webhook) means another branch in the
  bridge, not changes to detection, the queue, or the mailer.
- The opt-out lives on `form`, so it is deleted with the form and inherited by every
  destination on it.
- With `RESEND_API_KEY` unset the notification is a logged no-op; the badge still appears.
  A self-hoster who never configures Resend loses the email, not the signal.
- The email is composed from destination metadata only. The alert type has no payload
  field, so "no submission content in operational mail" is structural, not a convention.

---

## D-012 — Submission export: definition-derived columns, inert CSV, capped in memory

**Date:** 2026-08-17 · **Status:** Accepted · **Covers:** FR-SUB-4 ·
**Implements:** P-1, P-2 · **Relates to:** D-008

**Decision.** Export (`src/lib/export.ts`, `export-download.ts`, `export-links.ts`) is a
signed-in GET — `/api/forms/{formId}/export?format=csv|json` — surfaced from the dashboard
inbox card, and it follows five rules:

1. **Columns derive from the form definition (P-1), in definition order**, after four
   fixed metadata columns: `submission_id`, `submitted_at` (ISO-8601 UTC),
   `delivery_status` (the rolled-up per-submission state), and `content_status`
   (`retained` / `purged` — added by D-011, which exports a purged submission as a
   labelled tombstone with empty payload cells rather than dropping the row). Every
   defined field gets a column even when no exported row filled it — the file's shape is
   a property of the form, not of the batch. Payload keys **not** in the definition (BYO
   or legacy submissions) are appended after them, sorted lexicographically so the
   header is deterministic.
2. **CSV formula injection is neutralized, not merely escaped.** A value starting with
   `=`, `+`, `-`, `@`, TAB, or CR is prefixed with `'` so spreadsheets treat submitted
   content as text. Submissions are attacker-controlled, so this is a security rule
   (NFR-SEC-3), not formatting. Quoting is RFC 4180 on top of that.
3. **Non-scalar values are JSON-stringified in CSV and kept structured in JSON.** CSV is a
   flat format; inventing column-per-array-element would make the header depend on the
   data, contradicting rule 1.
4. **Exports are built in memory and capped at `EXPORT_ROW_LIMIT` (10,000) most recent
   submissions.** A form past the cap still downloads, with `X-Export-Truncated`,
   `X-Export-Row-Limit`, and `X-Export-Row-Count` telling the caller what happened.
5. **A URL, not a server function.** A download needs something the browser can navigate
   to, so the dashboard menu items are plain links to the documented endpoint rather than
   click handlers — one code path for the UI and for scripted use.

**Rationale.** Deriving columns from the definition keeps the export consistent with every
other artifact the definition drives (P-1) and makes two exports of the same form
diffable. Neutralizing formulas is the only place export can hurt someone: the person
opening the file is the form's owner. The row cap is what buys pure, unit-testable
serializers — a streaming export would move the rules into the transport.

**Implications.**
- Authorization is ownership in the query (D-008): a form you don't own answers exactly
  like one that doesn't exist (404), and no destination config or credential is reachable
  from the export path (P-2).
- The leading `'` on neutralized values is visible in the CSV. Consumers wanting the raw
  value should use the JSON export; this is documented in `docs/getting-started.md`.
- Renaming a definition field changes the column header; exports taken before and after a
  rename won't line up. Acceptable — the alternative is exporting internal ids.
- Beyond 10,000 submissions per form, export becomes lossy-by-recency. Date-range
  filtering or a streaming export is the escape hatch if that ceiling starts to bind
  (out of scope for FR-SUB-4).

---

## D-011 — Retention: 90-day default, purge by redaction, zero-retention on terminal delivery

**Date:** 2026-08-17 · **Status:** Accepted · **Resolves:** Q-3 (REQUIREMENTS.md §12) ·
**Covers:** FR-SUB-3, NFR-PRIV-1 · **Risk:** R-3 · **Constrained by:** P-5, NFR-OBS-1

**Decision.** Five parts, settled together because they only make sense together.

1. **Domain and default.** `form.retentionDays` means: `null` = retain indefinitely,
   `0` = zero-retention, `1…3650` = that many days. **Forms created from now on default
   to 90 days.** Existing forms are **not backfilled** — the migration leaves their `null`
   in place, so no submission stored under the old "indefinite" policy is deleted by the
   act of adopting this one. Owners opt back into indefinite retention explicitly.

2. **Zero-retention means persist → deliver → purge**, never "don't write" (P-5 is not
   negotiable). A `0` submission is purged once **every** delivery attempt for it has
   reached a terminal state (`succeeded` or `dead_letter`), or at a hard ceiling of
   **24 hours** after receipt if a destination is still retrying or stuck. The ceiling is
   generous against the retry envelope (5 attempts, ≤5 min backoff — D-006), so it fires
   only when something is wrong.

3. **Purge is redaction to a tombstone, not `DELETE`.** It clears the content columns of
   `submission` (`raw_body`, `normalized_payload`, `referer`, `client_fingerprint`,
   `user_agent`) and stamps a `purged_at`; the row and its `delivery_attempt` rows survive.
   On the attempt rows, `response_body` is cleared — a destination can echo the payload
   back — while `status`, `attempt`, `response_status`, timings and `error` are kept:
   connector errors are AutoForm's own message text, not submitted content.

4. **Retention is a property of the data, not of when the policy was set.** Shortening a
   form's window applies **retroactively** on the next purge pass; a form moved from 365
   to 30 days loses everything older than 30 days within minutes. The dashboard must warn
   before saving a reduction, and before enabling zero-retention.

5. **Purge runs in-process, on the same model as delivery** (D-006) — a separate pass
   beside the poller, on a slower cadence (target: every 5 minutes), batched with a
   per-pass row cap. It is idempotent (`purged_at is null and created_at < cutoff`), so
   concurrent instances duplicate work at worst, never corrupt. No external cron.

**Rationale.** R-3 makes retention defaults load-bearing, so the default has to be a
choice rather than an accident of a nullable column. A bounded default is the right one:
AutoForm is a **bridge**, and the durable copy of a submission is the one sitting in the
destination the owner chose. The inbox is a safety net for delivery failure, replay and
audit — 90 days is generous for that job, and unbounded storage of other people's personal
data on a free service (C-1) is a liability with no matching benefit.

Redaction rather than deletion is what lets retention and observability coexist.
`delivery_attempt` cascades on submission delete, so a hard `DELETE` would silently destroy
the delivery history NFR-OBS-1 and delivery-health detection depend on, and would make
"12 submissions received, 3 dead-lettered" unreconstructable. A tombstone keeps the
counts, the timeline and the failure record while holding no personal data — and it lets
the inbox say *"content purged"* instead of pretending the submission never arrived.
Deleting rows outright stays the tool for the **deletion-on-request** case (NFR-PRIV-2),
which is a different requirement with a different answer.

Running the pass in-process follows D-006 rather than inventing a second operational model
for one sweep — no extra infrastructure, nothing new to deploy (C-1/C-3).

**Implications.**
- A purged submission **cannot** be shown in the inbox, exported (FR-SUB-4) or replayed
  (FR-DEL-5). The inbox lists tombstones as purged rows with their delivery state intact;
  export skips their payload columns rather than emitting a misleading blank row; replay
  of a purged submission is refused, not attempted.
- **Any code that reads submission content must handle a tombstone.** `purged_at != null`
  means "content is gone", which is not the same as "no submission" and not the same as
  "empty payload".
- Retention is **best-effort promptness, not a hard guarantee**: the pass only runs while
  an app instance is running, so an instance that sleeps or scales to zero defers purging
  until it wakes. The contract is "kept for *at least* N days, deleted shortly after",
  and self-hosting docs must say so.
- Zero-retention data is reachable in the inbox for the few minutes between terminal
  delivery and the next pass. That is inherent to a polling model; anything tighter would
  mean purging inside the delivery path, which P-3 rules out.
- The purge pass needs its own tunables (cadence, batch cap, the 24h zero-retention
  ceiling) in the same place as the queue's, and the same "not yet env-driven" caveat
  applies (D-006).
- Schema work this implies — `submission.purged_at`, a default on `form.retention_days`,
  an index supporting the cutoff scan — belongs to the retention chunk, generated as a
  Drizzle migration, never hand-written SQL.

---

## D-010 — Delivery health: consecutive dead-letters, persisted alert de-duplication

**Date:** 2026-08-17 · **Status:** Accepted · **Covers:** FR-NOTIF-1, NFR-OBS-1 ·
**Builds on:** D-006 (row-per-attempt queue), D-007

**Decision.** A destination is judged healthy or not by a **consecutive dead-letter
counter**, evaluated event-driven at the moment a delivery reaches a terminal state
(`src/lib/queue.ts` → `finalize`), never by polling and never in the ingestion path (P-3).

1. **Threshold.** `DELIVERY_HEALTH_THRESHOLD` consecutive dead-letters (default **3**)
   flags the destination unhealthy. A `failed` attempt — one that still has a retry
   queued — is *not* counted; only `succeeded` and `dead_letter` are terminal.
2. **De-duplication.** State lives in a new `destination_health` table (one row per
   destination, cascade-deleted with it): the counter, `unhealthy_since`,
   `last_notified_at`, and the most recent error. One alert is emitted when the threshold
   is crossed, then suppressed for a cool-off of
   `DELIVERY_HEALTH_COOLOFF_MINUTES` (default **1440**, 24h) before it can repeat.
3. **Recovery.** Any success resets the counter and clears the unhealthy flag. A
   `recovered` signal is emitted **only if the owner was actually alerted** — a
   destination that failed twice and then succeeded is a non-event.
4. **Signal, not send.** Detection emits a `DeliveryHealthSignal` to an injectable
   `DeliveryHealthNotifier`. The default logs; the owner-email sender is injected at the
   worker boundary (`WorkerOptions.notify`), so the queue never imports a mail provider.

**Rationale.** Consecutive-failure counting is deterministic and needs no time-window
bookkeeping: one integer answers "is this destination broken *right now*", and a success
is the natural reset. A rolling window would flag a destination that failed five times
yesterday and has worked since. The state is **persisted rather than in-memory** so a
restart cannot un-suppress an alert and re-mail an owner about an outage they already know
about (NFR-REL-3's spirit). The read-modify-write happens inside a transaction over a
`FOR UPDATE`-locked row, so two workers dead-lettering simultaneously cannot both alert.

**Implications.**
- The counter is **per destination, not per form**: one broken webhook does not mute
  alerts for a healthy email destination on the same form.
- Detection is best-effort by design — `reportDeliveryOutcome` swallows its own errors so
  a health-tracking or notifier failure can never stall or crash delivery (NFR-REL-2/3).
  A dropped alert is strictly better than a stalled queue.
- Every terminal delivery now costs one extra small transaction. Acceptable at MVP
  volumes; if it ever matters, batch it in the worker tick rather than moving it onto the
  ingestion path.
- The default 24h cool-off means an owner hears about a persistent outage once a day, not
  once per submission. Lower it per deployment via env if that is too quiet.
- `destination_health` carries no submission content — only counts, timestamps, and the
  connector's own error text.
## D-009 — Spam protection: silent honeypot, in-process rate limiting

**Date:** 2026-06-25 · **Status:** Accepted · **Covers:** FR-SPAM-1/2 · **Risk:** R-2

**Decision.** Two MVP guards in the ingestion path (`src/lib/spam.ts`):

1. **Honeypot (FR-SPAM-1).** The generated embed includes an off-screen trap field
   (`form.honeypotField`, default `_gotcha`). If a submission fills it, the server
   **silently rejects** — no persist, no delivery — and returns a response **identical to
   success** (303 redirect / 200 JSON) so bots can't detect the trap.

2. **Rate limiting (FR-SPAM-2).** A process-local **fixed-window counter**: a coarse
   per-IP cap across all forms (checked before the DB lookup) and a per-`(form, IP)` limit
   using the form's `rateLimitPerMinute`. Exceeding either returns **429** with
   `Retry-After` (AJAX) or a friendly page (no-JS). A request with no derivable IP skips
   rate limiting.

**Rationale.** R-2 makes abuse controls load-bearing, not polish. In-memory limiting needs
no Redis/DB, fitting the MVP (C-1/C-3). Silent honeypot handling is the standard,
effective pattern.

**Implications.**
- The limiter is **per-instance**; horizontally scaling AutoForm would let each instance
  count separately. A shared store (Redis/DB) is future work (NFR-SCALE) — revisit before
  running multiple ingestion instances.
- Honeypot spam is **not stored** (the `submission.spamVerdict` column remains for a future
  abuse view, FR-SPAM-5). "No submission is lost" (P-5) applies to *accepted* submissions;
  spam is rejected, not accepted.
- Accurate client IPs depend on a correct `x-forwarded-for`/`x-real-ip` from the deploy
  proxy; misconfiguration weakens per-IP limits.

## D-008 — Dashboard authorization: ownership-scoped data layer behind thin server functions

**Date:** 2026-06-25 · **Status:** Accepted · **Implements:** P-2 ·
**Covers:** FR-ACC-1/2/3, FR-SUB-2, NFR-SEC-2

**Decision.** Dashboard data access lives in plain, testable functions
(`src/lib/forms.ts`, `destinations.ts`, `inbox.ts`) that **take `userId` explicitly and
enforce ownership in the query** (e.g. `where owner_id = userId`). TanStack Start **server
functions** (`src/lib/server-fns.ts`) are thin wrappers that resolve the Better Auth
session server-side (`requireUserId`) and delegate. Routes call only the server functions;
the route layout (`/dashboard`) guards with a `beforeLoad` redirect to `/login`.

**Secrets never cross to the client.** Server functions return DTOs that omit
`encryptedCredentials` (P-2/NFR-SEC-2). jsonb fields are typed as `JsonObject`
(`src/lib/json.ts`) at the boundary so they serialize cleanly (Start rejects `unknown`).

**Rationale.** Ownership-in-the-query makes authorization a property of the data layer, not
something each route remembers to check, and keeps it unit-testable without HTTP/session
mocking (see `dashboard.integration.test.ts`). The session lookup stays at the thin
server-fn edge.

**Implications.**
- New dashboard reads/mutations follow the same shape: a `*ForUser(userId, …)` function +
  a server-fn wrapper. Don't query owned resources without the `userId` predicate.
- Returning a DB row directly from a server function risks leaking secrets or non-
  serializable values — map to an explicit DTO.

## D-007 — Connector contract, retry classification, and worker activation

**Date:** 2026-06-25 · **Status:** Accepted · **Implements:** P-2, NFR-MAINT-1,
NFR-SEC-3 · **Covers:** FR-CON-1/2/3/6

**Decision.** Connectors implement one narrow contract (`src/connectors/types.ts`):
`deliver({ payload, config, credentials }) → DeliveryOutcome` plus an optional
`validateConfig`. They are registered in `src/connectors/index.ts`; the worker is handed
a single `dispatchDelivery` that routes a prepared `DeliveryContext` to the connector for
its `destination.type`. Adding a destination type = write a connector + register it;
ingestion and the queue are untouched.

**Connectors own retry classification.** Each `deliver` decides `retryable` and the queue
(D-006) obeys it. Convention: transport/timeout errors and HTTP 408/429/5xx are retryable;
other 4xx and missing/invalid config are non-retryable. An unknown destination type is a
non-retryable dead-letter.

**Credentials** are decrypted by the worker at delivery time (P-2) and passed as a plain
string the connector parses; the app-level Resend key is env, not per-destination.

**Sanitization (NFR-SEC-3)** lives in the connectors: the email connector strips CR/LF and
control chars from header fields (from/to/subject) to block header injection, and
HTML-escapes submitted values in the HTML body. Slack/chat-markup escaping is deferred with
that connector (Phase 1).

**Worker activation.** The in-process worker is started once at server boot from a custom
server entry (`src/server.ts`, wired via `tanstackStart({ server: { entry } })`). The
starter is idempotent, server-only, and a no-op without `DATABASE_URL` (so dev boots
without a DB); it lazy-imports the queue/connectors after that check.

**Implications.**
- The worker's default dispatcher (Chunk 3) is replaced in production by `dispatchDelivery`;
  unconnected types still dead-letter cleanly.
- New connectors must classify their own failures correctly or retries/dead-lettering will
  misbehave.

## D-006 — Delivery queue model: row-per-attempt, in-process poller

**Date:** 2026-06-24 · **Status:** Accepted · **Implements:** P-3, P-5 ·
**Covers:** FR-DEL-1/2/4, NFR-REL-2/3, NFR-OBS-1

**Decision.** The `delivery_attempt` table is **both the queue and the audit log** — no
separate jobs table. Each row is **one attempt** for one (submission × destination). A
single in-process polling worker (`src/lib/queue.ts`) drains it; no external broker
(Redis/SQS) in the MVP.

Status semantics: **`failed` always has a successor `pending` row; `dead_letter` is
terminal.** On a retryable failure with attempts remaining, the worker marks the current
row `failed` and inserts a fresh `pending` row (`attempt + 1`, `next_run_at` = now +
backoff). When non-retryable or `attempt >= MAX_ATTEMPTS` (5), the row becomes
`dead_letter`. Success → `succeeded`. Backoff is exponential with equal jitter.

Claiming is **`SELECT … FOR UPDATE SKIP LOCKED`** inside a transaction, flipping rows to
`processing` with `locked_at`/`locked_by`. A `processing` row whose `locked_at` is older
than the stale threshold is reclaimed to `pending` (crash recovery, NFR-REL-3). The
connector call is an injected **`DeliveryDispatcher`**, keeping the queue decoupled from
connectors (NFR-MAINT-1).

**Rationale.** One table gives a complete, queryable history of every attempt for the
dashboard (NFR-OBS-1) with no join to reconstruct timelines. `SKIP LOCKED` is the standard
Postgres pattern for safe concurrent claiming and lets the worker scale to multiple
processes later without redesign. Row-per-attempt keeps each row immutable once finalized,
which is easier to reason about than mutating a single counter.

**Implications.**
- Reading "current state" of a delivery = its **latest** attempt row (max `attempt`, or
  the non-`failed` one). The dashboard/inbox queries must account for this.
- `MAX_ATTEMPTS`, backoff, poll interval, batch size, and the stale-lock window are tunables
  in `queue.ts` (not yet env-driven).
- The worker is **injected** with the connector dispatcher; the default placeholder
  dead-letters until Chunk 4 registers real connectors.
- Activation is a server-boot concern: call `startDeliveryWorker({ dispatch })` once per
  process. Not wired into boot yet (pending the DB connection + Chunk 4 dispatcher).

## D-005 — Form-definition shape and two-step submission handling

**Date:** 2026-06-20 · **Status:** Accepted · **Implements:** P-1, D-001, D-002 ·
**Covers:** FR-FB-1/2, FR-ING-2, FR-VAL-1/2

**Decision.** The canonical form definition is `{ version: 1, fields: Field[] }`. Each
field has `name` (maps to the HTML input `name`), `label`, and `required?`. **MVP field
types:** `text`, `email`, `phone`, `textarea`, `number`, `select`, `radio`, `checkbox`
(single boolean), and `multiselect` (array; covers checkbox groups and `<select
multiple>`). It lives in `src/lib/validation.ts` as an ArkType meta-schema; TS types are
inferred from it (never hand-duplicated).

Submission handling is **two steps**: (1) **normalize** raw urlencoded/JSON values to the
field's runtime type (trim strings, coerce numbers, `on/true/1/yes`→boolean, repeated keys
→ array), then (2) **validate** the normalized object against the definition. **Unknown
fields are rejected** with *"this field doesn't match AutoForm's schema definitions"*
(D-001). Field names beginning with **`_` are reserved control fields** (`_redirect`,
`_gotcha` honeypot) — stripped before validation, never stored. **Multi-value inputs use
repeated `name`s** (no `[]` brackets). **Destinations are NOT part of the definition** —
routing is sourced from the `destination` table (per-form), avoiding a second source of
truth.

**Rationale.** One ArkType definition drives rendering, embed generation, validation, and
the inbox (P-1). The normalize→validate split honors "I don't care what you send at the
edge; past `submit` it must arrive in the expected shape," and leaves a clean, additive
path to new field types and constraints without breaking existing definitions.

**Implications.**
- `file` fields and conditional logic are out of scope (deferred features), not part of
  this schema.
- Adding a field type = extend the meta-schema union + add a normalize/validate branch;
  it's additive and keeps `version: 1` compatible.
- Connectors and storage always receive a normalized, validated payload — never raw edge
  input.
- BYO HTML must follow the field↔HTML conventions documented in
  [docs/form-fields.md](docs/form-fields.md).

## D-004 — Destination credentials encrypted with app-level AES-256-GCM, key in env

**Date:** 2026-06-20 · **Status:** Accepted · **Implements:** P-2, NFR-SEC-1

**Decision.** Destination secrets are encrypted at rest with **AES-256-GCM** in
application code (`src/lib/crypto.ts`), scoped per destination. The 256-bit key is held
in the **environment** (`ENCRYPTION_KEY`, 32 bytes base64), validated at startup. The
stored value is `"<version>:<base64(iv ‖ authTag ‖ ciphertext)>"`, and the **version
prefix** supports key rotation (old rows keep decrypting under their original key). The
ciphertext lives in the existing `destination.encrypted_credentials` text column — no
schema change. Decryption happens server-side only, at the moment of a delivery call;
plaintext never reaches the client.

**Rationale.** Authenticated encryption (GCM) detects tampering. An env-held key is free
(C-1), portable across hosts, and consistent with our existing server-only `env`/`db`
boundary. Versioning now buys painless rotation later. We chose this over Supabase Vault:

| | Env-held key (chosen) | Supabase Vault |
|---|---|---|
| **Cost** | Free | Free on Supabase, but couples us to it |
| **Portability** | Runs on any host / self-host (C-2, FR-DOC-6) | Tied to Supabase; self-hosters must replicate it |
| **Key/data separation** | Key lives outside the DB → a DB dump alone can't decrypt | Key managed in the DB tier; stronger if app env leaks, weaker if DB tier is breached |
| **Ops simplicity** | One env var; encrypt/decrypt in-process | Managed key lifecycle, but SQL-side encrypt/decrypt + RLS to wire |
| **Rotation** | Manual, enabled by our version prefix | Vault has built-in key management |
| **Audit/secret mgmt** | DIY (whatever the host's secret store offers) | Built-in, centralized |
| **Coupling** | None beyond Node `crypto` | Adds a hard Supabase dependency to the security model |

**Net:** the env approach keeps the project host-agnostic and the key physically separate
from the data, at the cost of DIY rotation/audit — acceptable for the MVP. Revisit Vault
or a cloud KMS if/when centralized key management and audit become requirements.

**Implications.**
- New required env var `ENCRYPTION_KEY`; the app fails fast if it is missing/!= 32 bytes.
- Connectors receive **decrypted** credentials from the delivery core at call time; they
  never read or write the encrypted column directly.
- Rotating keys = add the new version's key to the registry in `crypto.ts`, point
  `CURRENT_VERSION` at it, keep prior versions; optionally re-encrypt old rows.
- Losing `ENCRYPTION_KEY` means stored credentials are unrecoverable (by design).

## D-003 — Prefer shadcn/ui components over base HTML; custom components live in `components/`

**Date:** 2026-06-20 · **Status:** Accepted

**Decision.** When building UI, use **shadcn/ui** components instead of hand-rolling base
HTML elements wherever a suitable component exists or can be generated (e.g. use the
shadcn `Button`/`Input`/`Select` rather than raw `<button>`/`<input>`/`<select>`). Base
HTML is acceptable only for genuinely structural/semantic markup with no shadcn
equivalent.

When a **custom** component is needed (something shadcn doesn't provide), it lives in
**`src/components/`** — *not* in `src/components/ui/`, which is reserved for
shadcn-generated primitives. Keep the two clearly separated so shadcn additions/updates
never collide with bespoke code.

**Rationale.** Consistency, accessibility, and theming come for free from shadcn (the
project theme is set via a shadcn preset). Keeping shadcn output isolated in
`components/ui/` means the CLI can add/update primitives without touching our custom work.

**Implications.**
- Reach for `npx shadcn@latest add <component>` before writing markup by hand.
- `src/components/ui/` = shadcn-managed; treat as generated. `src/components/` = our
  custom components.
- The exception is the **generated embed/no-JS form output** (FR-EMB-1), which is plain
  HTML by design — it runs on the user's site, not in our React app, so it is out of scope
  for this rule.

## D-002 — ArkType is the canonical representation for every form definition

**Date:** 2026-06-19 · **Status:** Accepted · **Extends:** D-001

**Decision.** The form definition and all server-side submission validation are expressed
and enforced in **ArkType**, server-side. Whatever validation a BYO user runs on their own
side (HTML `required`, a client library, nothing at all) is **irrelevant** to AutoForm —
on receipt, every submission is validated and normalized through the form's ArkType
definition before it is accepted.

**Rationale.** D-001 makes the definition mandatory and uniform; this names the one
representation that enforces it. A single canonical schema language means ingestion,
storage, the inbox, and every connector all reason about the same validated shape. We do
not adapt to the user's tooling; we convert everything to ours.

**Implications.**
- The server is the only validation authority; client-side validation is a UX nicety, not
  a guarantee.
- Each form's definition is stored such that it can be loaded and applied as an ArkType
  schema at ingestion time.
- Connectors receive an already-normalized, ArkType-validated payload — they never
  re-validate edge input.

## D-001 — The form definition is mandatory for every form

**Date:** 2026-06-19 · **Status:** Accepted · **Resolves:** REQUIREMENTS.md Q-1

**Decision.** Every form has a canonical **form definition** (P-1). It is **mandatory**,
not optional — including for bring-your-own-HTML forms.

**Rationale.** What a form looks like at the edge is the user's business — any HTML, any
fields, any markup. But the moment a submission crosses the `submit` boundary, everything
must look and behave uniformly. A single, uniform schema governs ingestion, validation,
storage, and every connector. This keeps the inbox, normalization, and the whole
delivery/connector surface predictable and decoupled.

**Implications.**
- The edge is permissive: BYO forms may submit arbitrary named fields. The **server** is
  authoritative: submissions are validated and normalized against the form's definition.
- A submission that falls outside the schema is **wrong** and must be rejected/corrected —
  it is not silently passed through.
- `FormDefinition` is a **required** relation in the data model (not nullable).
- Overrides REQUIREMENTS.md's framing of FR-BYO-3 / FR-VAL-1 as conditional ("when a
  definition exists"): a definition always exists, so validation always applies.
- Creating a form (including a BYO form) requires producing/attaching a definition.
