# DECISIONS.md — AutoForm

A running log of **impactful, project-wide design decisions** — the "this is how we do
things" calls, not routine "which library" picks. Each entry is short and high-level: the
decision, why, and what it implies. Newest at the top.

> When you make a decision of this kind, **add an entry here** and reflect any operational
> rule it implies in [CLAUDE.md](CLAUDE.md). Tech-stack picks live in CLAUDE.md's stack
> table; this file is for cross-cutting principles and policies.

---

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
