# CLAUDE.md — AutoForm

Working guide for AI agents and contributors. Read this before making changes.

## Project overview

AutoForm is a free, open-source, embeddable **form-to-webhook bridge**: anyone can drop a
simple HTML form onto their site and have submissions reliably routed to Slack, Airtable,
email, or an arbitrary webhook — with no backend on the user's side. AutoForm provides a
public ingestion endpoint per form, validates and filters spam, persists every
submission, and delivers it asynchronously to one or more destinations.

- **Source of truth for requirements:** [REQUIREMENTS.md](REQUIREMENTS.md).
- **Current allowed scope:** [PHASE2.md](PHASE2.md) — Phase 0 (MVP) is complete; see
  [MVP.md](MVP.md) for what it covered.
- **Project-wide design decisions:** [DECISIONS.md](DECISIONS.md).

> **Hard scope rule:** **Phase 2** work — export, retention, delivery-health
> notifications, manual replay, self-hosting docs, the community-connector pathway — is in
> scope, on top of the completed Phase 0 core. Do **not** build **Phase 1** features
> (visual builder, iframe/JS-snippet embed tiers, Slack/Airtable connectors, OAuth,
> CAPTCHA, iframe theming, starter templates): they are planning only
> ([PHASE1.md](PHASE1.md)), and some Phase 2 issue bodies reference them as if they
> already exist. If a change seems to require one, stop and confirm scope first.
> REQUIREMENTS.md §4.2 is out of scope permanently, in every phase.

## Tech stack

These choices are fixed. Do not introduce alternatives without an explicit decision.

| Concern | Choice | Notes |
|---|---|---|
| Framework / scaffolding / routing | **TanStack Start** | Full-stack React. File-based routing, **server routes** for the `POST /f/{formId}` ingestion endpoint, **server functions** for dashboard mutations. |
| Validation | **ArkType** | All schema/validation: form-definition validation, request-body normalization/validation, and env validation. **Not Zod.** |
| UI components | **shadcn/ui** | Dashboard UI. Generate components via the shadcn CLI; do not hand-roll equivalents. |
| Icons | **Lucide** | The only icon library. Do not add others. |
| Database | **Supabase Postgres** | Managed Postgres. |
| ORM / data access | **Drizzle ORM** | All DB access goes through Drizzle. No raw SQL in app code. |
| Auth | **Better Auth** | Self-hosted; integrates with TanStack Start + Drizzle. |
| Email connector provider | **Resend** | Transactional provider for the email connector. |
| Async delivery | **DB-backed job queue + in-process polling worker** | No external broker (Redis/SQS) for the MVP. Jobs live in a table and are drained by a poller. |

## Architectural invariants (non-negotiable)

From REQUIREMENTS.md §5. Treat these as design invariants, not preferences.

- **P-1 — Form definition is the single source of truth.** The form definition (JSON
  describing fields, validation, destination references) drives everything: the rendered
  form, generated embed code, server-side validation, and routing are all *derived* from
  it. Model it as an ArkType schema and derive, never duplicate. **Every form has a
  definition — it is mandatory, including for BYO forms (see [DECISIONS.md](DECISIONS.md)
  D-001).** The edge is permissive (any HTML/fields); once a submission crosses `submit`,
  the server validates and normalizes it against the definition, and anything outside the
  schema is rejected as wrong.
- **P-2 — Secrets are server-side only.** Destination credentials (tokens, API keys) live
  only on the server, **encrypted at rest**, scoped per form/destination. The client and
  every embed hold only the **public, unguessable form ID**. Never serialize secrets into
  embeds, server-rendered HTML, or the client bundle.
- **P-3 — Delivery is asynchronous.** The ingestion request path never blocks on a
  destination API. Persist + enqueue, then return fast.
- **P-4 — Embedding is tiered.** No single embed works everywhere. **The MVP ships only
  the action-attribute (universal, no-JS) tier.** Iframe and JS-snippet tiers are Phase 1.
- **P-5 — No submission is lost.** Every accepted submission is persisted **before** any
  delivery attempt is made.

## Proposed project structure

To be created when the TanStack Start app is scaffolded. Target layout:

```
src/
  routes/
    f/$formId.ts          # POST ingestion endpoint (server route). urlencoded + JSON.
    success.tsx           # default hosted success page (FR-EMB-2)
    (dashboard)/          # authed dashboard: form list, create, endpoint view, inbox
  db/
    schema.ts             # Drizzle schema (Account, Form, FormDefinition [required],
                          #   Destination, Submission, DeliveryAttempt / jobs)
    migrations/           # Drizzle-generated migrations
    index.ts              # Drizzle client
  lib/
    queue.ts              # enqueue + in-process polling worker (retry/backoff/dead-letter)
    retention.ts          # retention vocabulary: the three states, their bounds and
                          #   UI copy (client-safe — no DB imports)
    retention-purge.ts    # age-based purge pass — redaction to a tombstone (D-011;
                          #   runs beside the poller, not a separate process)
    purge.ts              # zero-retention purge + the shared redactSubmissions primitive
    delivery-health.ts    # unhealthy-destination detection + alert de-duplication (D-010)
    delivery-notifications.ts # health signal → owner alert; per-form opt-out (D-013)
    mailer.ts             # AutoForm's own platform mail (NOT the email connector)
    mail-text.ts          # header-injection / HTML-escaping primitives shared by both
    validation.ts         # ArkType form-definition + request-body schemas
    spam.ts               # honeypot check, per-form/per-IP rate limiting
    auth.ts               # Better Auth setup (server)
    auth-client.ts        # Better Auth browser client
    crypto.ts             # AES-256-GCM encrypt/decrypt for destination credentials
    env.ts                # ArkType-validated environment variables
  connectors/
    types.ts              # the connector interface (see below)
    webhook.ts            # generic webhook connector
    email.ts              # Resend email connector (header-injection-safe)
    index.ts              # connector registry
  components/             # custom (non-shadcn) React components
    ui/                   # shadcn/ui generated primitives (treat as managed)
docs/                     # getting-started, form-fields (field↔HTML + shadcn), connectors,
                          #   notifications (delivery-health alerts + opt-out)
```

### Connector interface (REQUIREMENTS.md §9)

All connectors implement one narrow contract so the delivery core stays decoupled from
destinations (NFR-MAINT-1). The core treats connectors as **opaque**.

- `deliver(normalizedSubmission, config) → result` — performs the destination-specific
  call. Returns a structured result indicating success or a **retryable / non-retryable**
  failure, with enough detail to log.
- `validateConfig(config)` *(optional, Should)* — credential/test-delivery check used at
  configuration time.
- Each connector owns its own config shape, auth, and payload formatting. Adding a
  connector must not require changes to ingestion or delivery core.

## Conventions

- **TypeScript everywhere.** No plain `.js` app code.
- **ArkType, not Zod**, for every schema and validation boundary.
- **Drizzle for all DB access** — no raw SQL, no other query builders.
- **shadcn/ui via CLI** for components; **Lucide** for all icons. **Prefer shadcn
  components over base HTML** when a suitable one exists (`npx shadcn@latest add <name>`
  before hand-rolling markup). Custom (non-shadcn) components live in `src/components/`;
  `src/components/ui/` is reserved for shadcn-generated primitives (see
  [DECISIONS.md](DECISIONS.md) D-003). The project theme is applied via a shadcn preset.
- **Validate env at startup** with an ArkType schema (`lib/env.ts`); fail fast on missing
  secrets.
- **Secrets only in server context.** Anything imported into a client component must be
  free of credentials. Encrypt destination credentials at rest with `lib/crypto.ts`
  (AES-256-GCM, key in `ENCRYPTION_KEY`; see [DECISIONS.md](DECISIONS.md) D-004); decrypt
  only at delivery time, never on the client.
- **Sanitize submission content before it reaches connectors** — specifically guard email
  header injection and chat-markup injection (NFR-SEC-3).
- Keep the **ingestion path fast and side-effect-light**: validate → persist → enqueue →
  respond. Heavy work belongs in the worker.
- **Purging a submission is redaction, not deletion** ([DECISIONS.md](DECISIONS.md)
  D-011). Retention clears the content columns and stamps `purged_at`, leaving the
  `submission` row and its `delivery_attempt` history intact — a hard `DELETE` would
  cascade the history away and break NFR-OBS-1. Hard deletion is reserved for
  deletion-on-request (NFR-PRIV-2). **Anything that reads submission content must handle a
  tombstone:** `purged_at != null` means *content is gone*, which is neither "no
  submission" nor "empty payload" — the inbox, export and replay each need an explicit
  purged branch.
- **Operational mail is not a connector.** AutoForm's own email (delivery-health alerts)
  goes through `lib/mailer.ts`, never the connector registry — a destination is
  user-configured, platform mail is not. Never put submission content in it: alert types
  carry destination metadata only (see [DECISIONS.md](DECISIONS.md) D-013).
- **A notification can never break delivery.** Health detection and the notification
  bridge swallow their own errors and are injected at the worker boundary
  (`WorkerOptions.notify`), so the queue never imports a mail provider and a dropped alert
  never becomes a stalled queue (NFR-REL-2/3).
- **Don't convey status by colour alone** in the dashboard — pair it with an icon and a
  word (WCAG 2.1 AA 1.4.1, NFR-A11Y-1/2).

## Recording design decisions

[DECISIONS.md](DECISIONS.md) is the running log of **impactful, project-wide design
decisions** — the "this is how we do things" calls that cut across the codebase, not
routine "which library" picks (those belong in the stack table above).

- **When you make such a decision, add an entry to DECISIONS.md** (newest at top), and
  reflect any operational rule it implies back into the relevant section of this file.
- Use the existing entry format: an ID, date, status, the decision, rationale, and
  implications. Link to the requirement or open question it resolves where applicable.
- If you're unsure whether a decision qualifies: if it would surprise a new contributor,
  constrain future code, or override the requirements' framing, it qualifies — log it.

## Constraints to respect (REQUIREMENTS.md §1.4)

- **C-1 (Cost).** Service and software are free; no subscriptions/ads funding. Prefer
  free tiers and avoid paid dependencies where practical.
- **C-2 (Open source).** Permissive license (MIT or Apache 2.0); structure and document
  code to welcome outside contributors, especially connectors.
- **C-3 (Spare-time).** Scope is sized for spare-time delivery; keep the MVP lean.
- **C-4 (Attribution).** README/docs link prominently to the maintainer's portfolio as
  the project hub — **without degrading the experience of hosted-form end users**.
- **C-5 (No employer reference).** **No code, copy, branding, or design derived from the
  maintainer's current employer may appear anywhere** in the project or its public
  presence. Treat this as a hard prohibition.

## Commands

Package manager: **npm** (Node 24+).

```bash
npm install            # install dependencies
npm run dev            # dev server on http://localhost:3000
npm run build          # production build (also generates src/routeTree.gen.ts)
npm start              # run the production server (.output/server/index.mjs)
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run format         # prettier --write .
npm run db:generate    # drizzle-kit generate (create a migration from the schema)
npm run db:migrate     # drizzle-kit migrate (apply migrations)
npm run db:studio      # drizzle-kit studio
```

`src/routeTree.gen.ts` is generated by the TanStack Start Vite plugin on `dev`/`build`.
