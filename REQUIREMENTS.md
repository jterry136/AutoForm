# AutoForm — Requirements Document

| | |
|---|---|
| **Project** | AutoForm — embeddable form-to-webhook bridge |
| **Document** | Requirements specification |
| **Version** | 0.1 (draft) |
| **Date** | 19 June 2026 |
| **Status** | For review |
| **License intent** | Open source (permissive — e.g. MIT or Apache 2.0) |

---

## 1. Overview

### 1.1 Purpose
This document defines the functional and non-functional requirements for AutoForm, a lightweight, free, open-source service that routes HTML form submissions to destinations such as Slack, Airtable, email, and arbitrary webhooks — with no backend required on the user's side.

### 1.2 Problem statement
Small businesses, indie founders, and non-technical site owners routinely need a working contact, signup, or intake form. Building one means standing up a backend, handling delivery and spam, and wiring up integrations — disproportionate effort for a simple need. Existing hosted options are often paid, closed, or heavier than the problem warrants.

### 1.3 Solution summary
AutoForm provides a public ingestion endpoint per form. Users either build a form in a visual builder or bring their own HTML, drop the resulting embed onto any site, and configure where submissions should go. AutoForm validates, filters spam, stores, and reliably delivers each submission to one or more destinations.

### 1.4 Project context and constraints
- **C-1 (Cost).** The hosted service and the software are free; the project is funded by neither subscriptions nor ads.
- **C-2 (Open source).** All core code is publicly licensed and accepts community contributions, especially connectors.
- **C-3 (Spare-time delivery).** Built and maintained outside of full-time employment; scope is sized accordingly and sequenced into phases (see §11).
- **C-4 (Attribution).** The README and documentation link prominently back to the maintainer's portfolio site as the project's central hub. Attribution must not degrade the experience for users of the hosted forms.
- **C-5 (No employer reference).** No code, copy, branding, or design derived from the maintainer's current employer's work may appear anywhere in the project or its public presence.

---

## 2. Goals and non-goals

### 2.1 Goals
- Let a non-technical user get a working, delivering form live on their site in under ten minutes.
- Work across the widest practical range of hosting environments, from hand-coded sites to restrictive website builders.
- Make delivery reliable and observable — no silently lost submissions.
- Make the developer and documentation experience polished enough to be share-worthy on developer communities.
- Keep the connector surface small and well-documented so contributors can add destinations.

### 2.2 Non-goals
- AutoForm is not a full form-survey platform (no branching logic, scoring, multi-page wizards, or payments in scope for the covered phases).
- AutoForm is not a CRM or a data warehouse; stored submissions are a delivery safety net and a lightweight inbox, not a system of record.
- AutoForm does not aim to replace dedicated marketing-automation suites.

---

## 3. Target users

| Persona | Description | Primary need |
|---|---|---|
| **Non-technical founder / SMB owner** | Runs a small site, limited or no coding ability. | A form that just works and notifies them when someone submits. |
| **Website-builder user** | Site on Wix, Squarespace, or similar, with restricted custom-code support. | An embed that works within the builder's sandbox (typically iframe). |
| **Developer / freelancer** | Controls their own markup and can run JavaScript. | A clean endpoint and good DX; brings their own form. |
| **Contributor** | Open-source developer wanting to extend AutoForm. | A clear, narrow connector interface and contribution docs. |

---

## 4. Scope

### 4.1 In scope
Form creation (visual builder and bring-your-own-HTML), tiered embedding (action-attribute form, JS snippet, hosted iframe), submission ingestion and normalization, validation, spam/abuse protection, asynchronous delivery with retries, four first-party connectors (Slack, Airtable, email, generic webhook), submission storage and inbox, a minimal account dashboard, and documentation.

### 4.2 Out of scope (covered phases)
Payments and paid plans, conditional/branching logic, multi-step forms, file storage beyond basic attachment passthrough, white-label/custom-domain hosting, team/role management, and a public connector marketplace.

---

## 5. Key architectural principles
These principles constrain the requirements below and should be treated as non-negotiable design invariants.

- **P-1.** The **form definition** (a JSON schema describing fields, validation, and destination references) is the single source of truth. The rendered form, the generated embed code, the server-side validation, and the routing are all derived from it.
- **P-2.** Destination secrets (tokens, API keys) live **only** server-side and are never serialized into anything client-facing. The embedded form holds only a public, unguessable form ID.
- **P-3.** Delivery is **asynchronous**. The ingestion request path never blocks on a destination API.
- **P-4.** Embedding is **tiered**. No single embed works everywhere; AutoForm offers the right tier per platform.
- **P-5.** No submission is lost. Every accepted submission is persisted before any delivery is attempted.

---

## 6. Functional requirements

Priorities use MoSCoW: **Must**, **Should**, **Could**, **Won't (this phase)**.

### 6.1 Accounts and dashboard
| ID | Priority | Requirement |
|---|---|---|
| FR-ACC-1 | Must | A user can create an account and authenticate to manage their forms and destinations. |
| FR-ACC-2 | Must | A user can create, rename, list, and delete forms. |
| FR-ACC-3 | Must | Each form exposes a stable, unguessable public ID and its ingestion endpoint URL. |
| FR-ACC-4 | Should | A user can see per-form status at a glance: submission count, recent activity, and delivery health. |
| FR-ACC-5 | Could | A user can regenerate a form's public ID (rotating the endpoint) if it is being abused. |

### 6.2 Form creation — visual builder
| ID | Priority | Requirement |
|---|---|---|
| FR-FB-1 | Must | A non-technical user can build a form by adding and ordering fields (text, email, textarea, number, dropdown, checkbox, radio, file). |
| FR-FB-2 | Must | Each field supports a label, a name, a required flag, and basic per-type validation settings. |
| FR-FB-3 | Must | The builder serializes the form into the canonical form-definition JSON (P-1). |
| FR-FB-4 | Must | The builder produces ready-to-paste embed code for the user's chosen platform/tier (see §6.4). |
| FR-FB-5 | Should | The builder previews the rendered form live as it is edited. |
| FR-FB-6 | Could | The builder offers a small set of starter templates (contact, signup, feedback). |

### 6.3 Form creation — bring-your-own-HTML
| ID | Priority | Requirement |
|---|---|---|
| FR-BYO-1 | Must | A developer can point their own existing HTML form's `action` at the form's endpoint without using the builder. |
| FR-BYO-2 | Must | The ingestion endpoint accepts and normalizes whatever named fields are submitted, even for forms not described by a stored definition. |
| FR-BYO-3 | Should | A developer can optionally attach a form definition to a BYO form to enable server-side validation and field labeling in the inbox. |

### 6.4 Embedding and distribution
| ID | Priority | Requirement |
|---|---|---|
| FR-EMB-1 | Must | **Action-attribute form (universal tier).** Generate a plain `<form action=… method="POST">` that works with no JavaScript on any site that allows pasted HTML. |
| FR-EMB-2 | Must | Support a post-submission redirect via a hidden `_redirect` field, and provide a default hosted success page when none is set. |
| FR-EMB-3 | Should | **JS snippet (enhanced tier).** Provide a script that submits via fetch (no page navigation), shows inline success/error, and runs client-side validation. |
| FR-EMB-4 | Must | **Hosted iframe (builder tier).** Render a self-contained form from the form definition, embeddable via `<iframe>`, for sandboxed builders (e.g. Wix HTML embed, Squarespace code block). |
| FR-EMB-5 | Must | The iframe communicates height and submission events to the host page via `postMessage` (auto-resize, redirect-on-success). |
| FR-EMB-6 | Should | The hosted iframe form supports basic theming (colors, fonts, spacing) so it can approximate the host site's look. |
| FR-EMB-7 | Should | The builder's "get embed code" step recommends the correct tier per platform and includes copy-paste instructions for common platforms. |

### 6.5 Submission ingestion
| ID | Priority | Requirement |
|---|---|---|
| FR-ING-1 | Must | Accept submissions at `POST /f/{formId}` as both `application/x-www-form-urlencoded` and `application/json`. |
| FR-ING-2 | Must | Normalize the incoming body into a structured key-value payload regardless of content type. |
| FR-ING-3 | Must | Persist the raw and normalized submission before attempting any delivery (P-5). |
| FR-ING-4 | Must | Enqueue delivery jobs and return a fast response (redirect for the no-JS path, JSON for the AJAX path) without waiting on destinations (P-3). |
| FR-ING-5 | Should | Capture submission metadata: timestamp, originating page/referer, and a coarse client fingerprint for abuse handling. |
| FR-ING-6 | Could | Support file uploads as attachment passthrough to destinations that accept them. |

### 6.6 Validation
| ID | Priority | Requirement |
|---|---|---|
| FR-VAL-1 | Must | When a form definition exists, validate submissions server-side against it (required fields, types, basic constraints). |
| FR-VAL-2 | Must | On validation failure, return a clear error to the AJAX path and a friendly error page to the no-JS path. |
| FR-VAL-3 | Should | The generated snippet/iframe performs matching client-side validation for immediate feedback. |

### 6.7 Spam and abuse protection
| ID | Priority | Requirement |
|---|---|---|
| FR-SPAM-1 | Must | Inject a honeypot field into all generated embeds and silently reject submissions that populate it. |
| FR-SPAM-2 | Must | Enforce per-form and per-IP rate limiting. |
| FR-SPAM-3 | Should | Validate `Origin`/`Referer` against the form's configured allowed domain(s) and reject mismatches. |
| FR-SPAM-4 | Should | Support an optional CAPTCHA (e.g. Cloudflare Turnstile or hCaptcha) per form. |
| FR-SPAM-5 | Could | Provide a per-form abuse view and a block/allow list. |

### 6.8 Delivery and routing
| ID | Priority | Requirement |
|---|---|---|
| FR-DEL-1 | Must | A delivery worker consumes queued submissions and fans each out to all of the form's configured destinations. |
| FR-DEL-2 | Must | Failed deliveries are retried with backoff up to a configured limit, then dead-lettered. |
| FR-DEL-3 | Must | A form supports multiple destinations simultaneously. |
| FR-DEL-4 | Should | Each delivery attempt records status, response, and timing for observability. |
| FR-DEL-5 | Should | A user can manually replay a failed or dead-lettered delivery from the dashboard. |

### 6.9 Connectors
| ID | Priority | Requirement |
|---|---|---|
| FR-CON-1 | Must | Connectors implement a single, narrow interface (see §9) and are pluggable. |
| FR-CON-2 | Must | Ship a **generic webhook** connector that POSTs the normalized payload as JSON to a user-supplied URL. |
| FR-CON-3 | Must | Ship an **email** connector that sends the submission to one or more addresses via a transactional provider, with header-injection-safe formatting. |
| FR-CON-4 | Must | Ship a **Slack** connector; configuration should use OAuth and a channel picker rather than requiring the user to paste a webhook URL. |
| FR-CON-5 | Must | Ship an **Airtable** connector that maps fields to a chosen base/table, populating base/table choices from Airtable's API rather than requiring manual IDs. |
| FR-CON-6 | Should | Connector configuration is validated at setup time (test delivery / credential check). |
| FR-CON-7 | Could | Document and support community-contributed connectors. |

### 6.10 Submission storage and inbox
| ID | Priority | Requirement |
|---|---|---|
| FR-SUB-1 | Must | Store accepted submissions so they are recoverable independent of delivery outcome. |
| FR-SUB-2 | Must | Provide a per-form inbox view of submissions in the dashboard. |
| FR-SUB-3 | Should | Support configurable retention (including a short or zero-retention option) per form for privacy. |
| FR-SUB-4 | Should | Allow export of submissions (CSV/JSON). |

### 6.11 Notifications and delivery status
| ID | Priority | Requirement |
|---|---|---|
| FR-NOTIF-1 | Should | Notify the form owner when deliveries to a destination are failing repeatedly. |
| FR-NOTIF-2 | Could | Offer an optional email digest of recent submissions. |

### 6.12 Documentation and developer experience
| ID | Priority | Requirement |
|---|---|---|
| FR-DOC-1 | Must | Provide a getting-started guide that takes a user from zero to a live, delivering form. |
| FR-DOC-2 | Must | Document each embed tier with copy-paste examples and per-platform instructions (including Wix and Squarespace). |
| FR-DOC-3 | Must | Document each connector's configuration. |
| FR-DOC-4 | Must | Provide a contributor guide covering the connector interface and local setup. |
| FR-DOC-5 | Must | README and docs link prominently to the maintainer's portfolio (C-4). |
| FR-DOC-6 | Should | Provide self-hosting instructions so the open-source service can be run independently. |

---

## 7. Non-functional requirements

### 7.1 Performance
- **NFR-PERF-1 (Must).** The ingestion endpoint responds in well under one second at the median, because it does no synchronous destination work.
- **NFR-PERF-2 (Should).** The hosted iframe form renders and becomes interactive quickly enough to feel native on the host page.

### 7.2 Reliability and availability
- **NFR-REL-1 (Must).** No accepted submission is lost, even if all destinations are unavailable (P-5).
- **NFR-REL-2 (Must).** Transient destination failures are retried; persistent failures are dead-lettered, not dropped.
- **NFR-REL-3 (Should).** The delivery worker can be restarted without losing in-flight jobs.

### 7.3 Security
- **NFR-SEC-1 (Must).** Destination credentials are encrypted at rest and scoped per form/destination (P-2).
- **NFR-SEC-2 (Must).** Credentials are never exposed to the client or included in any embed.
- **NFR-SEC-3 (Must).** Submission content is sanitized before reaching connectors, with specific attention to email header injection and chat-markup injection.
- **NFR-SEC-4 (Must).** The AJAX path uses a correctly scoped CORS policy.
- **NFR-SEC-5 (Should).** Public form IDs are unguessable and high-entropy.

### 7.4 Privacy and data protection
- **NFR-PRIV-1 (Must).** Submission data retention is configurable, including a minimal/zero-retention mode (FR-SUB-3).
- **NFR-PRIV-2 (Should).** Provide guidance and tooling for deleting a form's stored submissions on request.

### 7.5 Scalability
- **NFR-SCALE-1 (Should).** The ingestion and delivery paths scale horizontally and independently.
- **NFR-SCALE-2 (Could).** The queue and worker handle bursty traffic (e.g. a form going viral) without dropping submissions.

### 7.6 Accessibility
- **NFR-A11Y-1 (Must).** Forms rendered by AutoForm (builder preview and hosted iframe) meet WCAG 2.1 AA for labels, focus, and error messaging.
- **NFR-A11Y-2 (Should).** The dashboard is keyboard-navigable and screen-reader friendly.

### 7.7 Maintainability and extensibility
- **NFR-MAINT-1 (Must).** Connectors are isolated behind the §9 interface so adding one does not require changes to ingestion or delivery core.
- **NFR-MAINT-2 (Should).** The codebase is structured and documented to lower the barrier for outside contributors (C-2).

### 7.8 Observability
- **NFR-OBS-1 (Must).** Delivery attempts, failures, and dead-letters are logged and surfaced in the dashboard.
- **NFR-OBS-2 (Should).** Operational metrics (ingestion rate, queue depth, delivery success rate) are available to the maintainer.

---

## 8. Data model (high level)
Indicative entities; not a final schema.

- **Account** — the owning user; authentication identity.
- **Form** — public ID, owner, allowed origins, redirect/success settings, spam settings, retention policy.
- **FormDefinition** — the canonical JSON schema for a form's fields and validation (P-1); optional for BYO forms.
- **Destination** — type (slack/airtable/email/webhook), encrypted credentials, type-specific config, association to a form.
- **Submission** — form reference, raw body, normalized payload, metadata (timestamp, referer, fingerprint), spam verdict.
- **DeliveryAttempt** — submission reference, destination reference, status, response, timing, attempt number.

---

## 9. Connector interface
All connectors implement one narrow contract so the delivery core and individual destinations stay decoupled (NFR-MAINT-1).

- **Input:** the normalized submission payload plus the destination's stored configuration.
- **Operation:** `deliver(normalizedSubmission, config) → result` — performs the destination-specific call.
- **Output:** a structured result indicating success or a retryable/non-retryable failure, with enough detail to log (FR-DEL-4).
- **Setup hook (Should):** an optional `validateConfig(config)` or test-delivery routine used at configuration time (FR-CON-6).
- Each connector owns its own configuration shape, authentication, and payload formatting; the core treats connectors as opaque.

---

## 10. Success metrics
- **M-1.** Time-to-first-delivering-form for a new non-technical user (target: under 10 minutes).
- **M-2.** Successful delivery rate across all attempts (excluding genuine destination outages).
- **M-3.** Breadth of platforms with confirmed working embeds (at minimum: hand-coded, WordPress, Wix, Squarespace).
- **M-4.** Community traction: GitHub stars, external contributors, and connectors contributed by non-maintainers.
- **M-5.** Documentation completeness: every embed tier and connector has a working, tested example.

---

## 11. Phased roadmap
Phases describe build order, not scope cuts — all in-scope items remain in scope. Sequencing front-loads the reliable core, then adds the non-technical and builder-audience surface.

**Phase 0 — Core pipeline (MVP).**
Ingestion endpoint, normalization, persistence, queue, delivery worker with retries and dead-lettering, the connector interface, and two connectors (generic webhook, email). Action-attribute embed tier with redirect/success handling. Honeypot and rate limiting. Minimal dashboard: create form, view endpoint, submission inbox. Getting-started docs.

**Phase 1 — Non-technical and builder audience.**
Visual form builder producing the canonical definition. Hosted iframe tier with `postMessage` resize/redirect and basic theming. JS snippet tier. Slack and Airtable connectors with OAuth/picker-based setup. Origin checks and optional CAPTCHA. Per-platform embed docs including Wix and Squarespace.

**Phase 2 — Polish and reach.**
Delivery-health notifications, manual replay, submission export, configurable retention, templates, self-hosting docs, and the contributor pathway for community connectors.

---

## 12. Risks and open questions
- **R-1.** Builder sandboxes change; iframe behavior on Wix/Squarespace must be re-verified periodically (validated by M-3).
- **R-2.** A free, public ingestion endpoint is an abuse magnet; spam/abuse controls (§6.7) are load-bearing, not optional polish.
- **R-3.** Stored submissions create privacy and compliance obligations; retention defaults and deletion tooling (§7.4) must be settled early.
- **Q-1.** Should the canonical form definition be mandatory for all forms, or remain optional for BYO forms (affects validation guarantees and inbox labeling)?
- **Q-2.** Which transactional email provider(s) to standardize on for the email connector, balancing free-tier limits against deliverability?
- **Q-3.** What is the default submission retention period, and is zero-retention offered from Phase 0 or deferred to Phase 2?