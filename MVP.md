# MVP.md — AutoForm Phase 0 (Core pipeline)

The current, **only** allowed scope. Derived from [REQUIREMENTS.md](REQUIREMENTS.md) §11
("Phase 0 — Core pipeline (MVP)"). Architecture guardrails live in [CLAUDE.md](CLAUDE.md).

> Phases describe **build order, not scope cuts** — deferred items remain in scope for the
> project overall, just not for Phase 0. Do not build Phase 1/2 features now.

## Phase 0 goal

Stand up the **reliable core pipeline**: a public ingestion endpoint that validates,
filters spam, persists, and asynchronously delivers each submission to one or more
destinations (webhook + email), plus a minimal dashboard and getting-started docs. A
developer should be able to point a plain HTML form's `action` at AutoForm and have
submissions delivered.

## Requirements checklist

### Accounts & dashboard
- [ ] **FR-ACC-1 (Must)** — Create an account and authenticate to manage forms and
  destinations. *(Better Auth)*
- [ ] **FR-ACC-2 (Must)** — Create, rename, list, and delete forms.
- [ ] **FR-ACC-3 (Must)** — Each form exposes a stable, **unguessable public ID** and its
  ingestion endpoint URL.
- [ ] Minimal dashboard surface: create form, **define its form definition**, view
  endpoint, submission inbox.
- [ ] **Minimal definition authoring (Phase 0).** Since the form definition is mandatory
  (D-001) but the visual builder is Phase 1, Phase 0 needs a **basic way to author/attach
  a definition** when a form is created — e.g. a simple field/JSON editor, not the full
  builder. This applies to BYO forms too: the user brings whatever HTML they like, but
  must declare the canonical definition AutoForm validates against.

### Bring-your-own-HTML
- [ ] **FR-BYO-1 (Must)** — A developer can point an existing HTML form's `action` at the
  form endpoint without using a builder.
- [ ] **FR-BYO-2 (Must)** — The endpoint accepts and normalizes whatever named fields are
  submitted, even with no stored form definition.

### Embedding — universal (action-attribute) tier only
- [ ] **FR-EMB-1 (Must)** — Generate a plain `<form action=… method="POST">` that works
  with **no JavaScript** on any site that allows pasted HTML.
- [ ] **FR-EMB-2 (Must)** — Post-submission redirect via a hidden `_redirect` field, with
  a **default hosted success page** when none is set.

### Submission ingestion
- [ ] **FR-ING-1 (Must)** — Accept `POST /f/{formId}` as both
  `application/x-www-form-urlencoded` and `application/json`.
- [ ] **FR-ING-2 (Must)** — Normalize the body into a structured key-value payload
  regardless of content type.
- [ ] **FR-ING-3 (Must)** — Persist raw + normalized submission **before** any delivery
  (P-5).
- [ ] **FR-ING-4 (Must)** — Enqueue delivery jobs and return a fast response (redirect for
  no-JS, JSON for AJAX) without waiting on destinations (P-3).

### Validation (when a definition exists)
- [ ] **FR-VAL-1 (Must)** — Validate every submission server-side against the form's
  definition (required fields, types, basic constraints).
- [ ] **FR-VAL-2 (Must)** — On failure, return a clear error to the AJAX path and a
  friendly error page to the no-JS path.
- _Note:_ the form definition is **mandatory for every form** ([DECISIONS.md](DECISIONS.md)
  D-001), so validation always applies — including BYO forms. The visual builder that
  *authors* definitions is Phase 1, but a definition must exist for any Phase 0 form, so
  the definition model + validation core are required now (see minimal definition
  authoring above).
- _Note:_ validation is enforced in **ArkType server-side** ([DECISIONS.md](DECISIONS.md)
  D-002). Whatever validation a BYO user runs on their side is irrelevant — every
  submission is converted to and validated against the form's ArkType definition on
  receipt. Client-side validation is UX only, never a guarantee.

### Spam & abuse protection
- [ ] **FR-SPAM-1 (Must)** — Inject a **honeypot** field into generated embeds and
  silently reject submissions that populate it.
- [ ] **FR-SPAM-2 (Must)** — Enforce **per-form and per-IP rate limiting**.

### Delivery & routing
- [ ] **FR-DEL-1 (Must)** — A delivery worker consumes queued submissions and fans each
  out to **all** of the form's configured destinations. *(DB-backed queue + in-process
  poller)*
- [ ] **FR-DEL-2 (Must)** — Failed deliveries are retried with backoff up to a limit, then
  **dead-lettered** (never dropped).
- [ ] **FR-DEL-3 (Must)** — A form supports **multiple destinations** simultaneously.

### Connectors
- [ ] **FR-CON-1 (Must)** — Connectors implement a single narrow, pluggable interface
  (REQUIREMENTS.md §9).
- [ ] **FR-CON-2 (Must)** — **Generic webhook** connector: POST the normalized payload as
  JSON to a user-supplied URL.
- [ ] **FR-CON-3 (Must)** — **Email** connector: send the submission to one or more
  addresses, **header-injection-safe** formatting. *(Resend)*

### Submission storage & inbox
- [ ] **FR-SUB-1 (Must)** — Store accepted submissions, recoverable independent of
  delivery outcome.
- [ ] **FR-SUB-2 (Must)** — Per-form **inbox view** of submissions in the dashboard.

### Documentation
- [ ] **FR-DOC-1 (Must)** — Getting-started guide: zero → a live, delivering form.

## Non-functional requirements in scope for Phase 0
- [ ] **NFR-PERF-1 (Must)** — Ingestion responds well under one second at the median (no
  synchronous destination work).
- [ ] **NFR-REL-1 (Must)** — No accepted submission is lost, even if all destinations are
  down (P-5).
- [ ] **NFR-REL-2 (Must)** — Transient failures retried; persistent failures dead-lettered.
- [ ] **NFR-SEC-1 (Must)** — Destination credentials encrypted at rest, scoped per
  form/destination (P-2).
- [ ] **NFR-SEC-2 (Must)** — Credentials never exposed to client or any embed.
- [ ] **NFR-SEC-3 (Must)** — Submission content sanitized before reaching connectors
  (email header injection, chat-markup injection).
- [ ] **NFR-SEC-4 (Must)** — AJAX path uses a correctly scoped CORS policy.
- [ ] **NFR-MAINT-1 (Must)** — Connectors isolated behind the §9 interface; adding one
  needs no ingestion/delivery-core changes.
- [ ] **NFR-OBS-1 (Must)** — Delivery attempts, failures, and dead-letters are logged and
  surfaced in the dashboard.
- [ ] **NFR-A11Y-1 (Must)** — Rendered success/error pages meet WCAG 2.1 AA for labels,
  focus, and error messaging.

## Data model touched in Phase 0 (high level)
`Account`, `Form`, `FormDefinition` (**required** — D-001), `Destination` (webhook/email
only), `Submission`, `DeliveryAttempt`. See REQUIREMENTS.md §8.

## Explicitly deferred — NOT in the MVP
Visual form builder · hosted iframe tier · JS-snippet tier · Slack connector · Airtable
connector · OAuth / channel & base pickers · origin/referer checks · CAPTCHA · iframe
theming · submission export · configurable/zero retention · manual replay · delivery-health
notifications · digests · starter templates · self-hosting docs · community-connector
pathway. *(Phases 1–2.)*

## Open questions to settle before/while building
- **Q-1** — ✅ **Resolved:** the canonical form definition is **mandatory for all forms**,
  including BYO. See [DECISIONS.md](DECISIONS.md) D-001.
- **Q-3** — Default submission **retention period**, and whether **zero-retention** ships
  in Phase 0 or is deferred to Phase 2. _Pending._
