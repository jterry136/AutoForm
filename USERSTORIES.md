# USERSTORIES.md — AutoForm

Four user stories spanning AutoForm's key audiences and how each would use the platform.
Grounded in the target users in [REQUIREMENTS.md](REQUIREMENTS.md) §3. Each notes whether the
flow is supported **today (Phase 0)** or planned (**Phase 1**, see [PHASE1.md](PHASE1.md)).

---

## 1. Priya — non-technical SMB owner

> **As** the owner of a small bakery website, **I want** a contact form that emails me every
> inquiry, **so that** I never miss a customer without standing up a backend.

**Who she is.** Runs a one-person bakery. Built her site on a simple hosting plan; can paste
HTML but doesn't code. No interest in servers, spam filters, or APIs.

**Scenario.**
1. Signs up, creates a "Contact us" form (name, email, message).
2. Adds an **Email** destination pointing at her inbox.
3. Copies the generated `<form>` embed and pastes it onto her Contact page.
4. A customer submits; Priya gets the email minutes later. She checks the dashboard **inbox**
   to confirm it was delivered.

**What she values.** It "just works," no code or backend; she's notified on every submission;
spam is filtered for her; nothing is silently lost.

**Acceptance criteria.**
- Live, delivering form in under ten minutes.
- Submissions arrive by email and are visible in the inbox with a delivery status.
- Bot/spam submissions are filtered without her configuring anything.

**Support:** Phase 0 ✅ (email connector, universal embed, honeypot, inbox).

---

## 2. Marco — website-builder user (Wix / Squarespace)

> **As** a consultant running my site on a hosted builder, **I want** an embedded form that
> works inside the builder's sandbox, **so that** I can collect leads without its restrictive
> form tools or custom-code limits.

**Who he is.** Uses a drag-and-drop builder that blocks raw `<form>` posting and arbitrary
scripts but allows an **HTML/embed block** (typically an iframe).

**Scenario.**
1. Builds a "Book a consultation" form and styles it to roughly match his site.
2. The dashboard recommends the **iframe** tier for his platform and gives copy-paste
   instructions for his builder.
3. He pastes the iframe into an embed block; it auto-sizes and, on submit, redirects to his
   thank-you page.
4. Leads route to both his email and a webhook into his CRM.

**What he values.** An embed that survives the builder's sandbox; looks native; per-platform
guidance; multiple destinations at once.

**Acceptance criteria.**
- A self-contained iframe form that renders and resizes correctly inside the builder.
- `postMessage` redirect/resize and basic theming.
- Documented, tested steps for Wix and Squarespace.

**Support:** **Phase 1** (hosted iframe tier, theming, per-platform docs). Today he could use
the universal embed only where the builder allows pasted `<form>` HTML.

---

## 3. Dana — developer / freelancer (bring your own HTML)

> **As** a developer building a client site, **I want** to point my own form at a clean
> endpoint, **so that** I get reliable delivery and spam handling without writing or hosting
> backend code.

**Who she is.** Controls her own markup and can run JavaScript. Wants good DX, predictable
behavior, and no lock-in to a form builder.

**Scenario.**
1. Creates a form in AutoForm and defines its schema (fields + validation).
2. Sets her existing hand-written `<form>`'s `action` to the form's endpoint — no builder.
3. Submits real and malformed payloads while testing: valid ones deliver to a **webhook**;
   anything outside the schema is rejected with a clear error.
4. Adds a hidden `_redirect` for the no-JS flow and wires the AJAX/JSON path for inline UX.

**What she values.** A clean `POST /f/{id}` endpoint accepting urlencoded **and** JSON;
server-side validation she controls; fast responses; submissions stored as a safety net.

**Acceptance criteria.**
- Endpoint accepts both content types and normalizes them.
- Submissions validated against her definition; unknown/invalid fields rejected clearly.
- Sub-second responses; retried, never-dropped delivery; visible delivery attempts.

**Support:** Phase 0 ✅ (BYO endpoint, JSON + urlencoded, validation, async delivery, inbox).

---

## 4. Sam — open-source contributor

> **As** an OSS developer who relies on a tool AutoForm doesn't yet support, **I want** to add
> a new connector through a small, well-documented interface, **so that** I can deliver
> submissions there and contribute it back.

**Who they are.** Comfortable in a TypeScript codebase. Wants to extend AutoForm — e.g., a
Discord or Notion connector — without learning the whole system.

**Scenario.**
1. Reads the connector docs and the `Connector` interface.
2. Implements `deliver(...)` (and optional `validateConfig`) for their destination, choosing
   retryable vs non-retryable failures.
3. Registers the connector; ingestion and the delivery queue need no changes.
4. Adds tests, opens a PR; the new destination type appears in the dashboard.

**What they value.** A narrow, opaque connector contract; isolation from ingestion/delivery
core; clear contribution docs and local setup; a permissive license.

**Acceptance criteria.**
- A connector can be added by implementing one interface and registering it.
- No edits to ingestion or the delivery core required.
- Documented interface, local-dev setup, and tests to follow.

**Support:** Phase 0 ✅ (connector contract + registry, webhook/email exemplars, connector
docs). First-party Slack/Airtable connectors and the community pathway expand in Phase 1/2.

---

### Coverage at a glance

| Story | Persona | Core use case | Primary embed tier | Status |
|---|---|---|---|---|
| 1 | SMB owner | Contact form → email | Universal `<form>` | Phase 0 |
| 2 | Builder user | Lead form in a sandbox | Hosted iframe | Phase 1 |
| 3 | Developer | BYO form → webhook | Action-attribute / AJAX | Phase 0 |
| 4 | Contributor | Add a connector | n/a | Phase 0 |
