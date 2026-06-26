# PHASE1.md — Phase 1 chunk plan (proposed)

**Status: planning only.** Phase 0 (MVP) is complete; Phase 1 work is **not yet in scope**
and must not begin without explicit go-ahead (see the hard scope rule in
[CLAUDE.md](CLAUDE.md)). This file defines the chunks so we can sequence them later.

Phase 1 targets the **non-technical and builder audience** (REQUIREMENTS.md §11): a visual
builder, the iframe and JS-snippet embed tiers, Slack/Airtable connectors, origin
checks/CAPTCHA, and per-platform docs.

## Shared foundations (build once, several chunks depend on them)

- **F-A — Public form-config endpoint.** A read-only, CORS-scoped endpoint that serves a
  form's *public* definition (fields/validation, no secrets) so client-side renderers and
  validators (JS snippet, iframe) can fetch it by public ID. Derives from the definition
  (P-1); reuses `formDefinitionSchema`.
- **F-B — Definition-driven renderer.** A shared component that renders an accessible form
  (WCAG 2.1 AA, NFR-A11Y-1) from a definition — used by the builder preview *and* the iframe
  tier, so render logic lives in one place.
- **F-C — Connector OAuth/connection subsystem.** Generic OAuth + stored-connection plumbing
  (encrypted tokens, refresh) that the Slack and Airtable connectors share, plus a
  picker/config UI pattern. Extends the connector contract (D-007) without touching the
  delivery core.

## Chunks

### P1-1 — Visual form builder
Add/order/remove fields with per-type settings; serialize to the canonical definition (P-1);
live preview; "get embed code" step; starter templates (contact/signup/feedback).
- **Requirements:** FR-FB-1…6, FR-EMB-7.
- **Depends on:** F-B (preview). Replaces the MVP's raw-JSON definition authoring.
- **Notes:** the builder only *produces* the existing definition shape (D-005) — no schema
  change. Largest chunk; could split into builder-core vs preview/templates.

### P1-2 — JS snippet (enhanced) embed tier
A `<script>` that renders/enhances the form, submits via `fetch` (no navigation), shows
inline success/error, and runs client-side validation matching the server.
- **Requirements:** FR-EMB-3, FR-VAL-3.
- **Depends on:** F-A (fetch definition for client validation). Reuses the AJAX path +
  scoped CORS already built.

### P1-3 — Hosted iframe (builder) tier
Render a self-contained form from the definition, embeddable via `<iframe>`; `postMessage`
for auto-resize and redirect/submission events; basic theming (colors/fonts/spacing).
- **Requirements:** FR-EMB-4/5/6, NFR-PERF-2, NFR-A11Y-1.
- **Depends on:** F-A, F-B.
- **Notes:** primary tier for sandboxed builders (Wix/Squarespace) — verify against R-1.

### P1-4 — Origin/referer checks + per-form CORS
Validate `Origin`/`Referer` against the form's `allowedOrigins` (column already exists);
scope the AJAX CORS policy per form instead of `*`.
- **Requirements:** FR-SPAM-3, NFR-SEC-4 (tighten).
- **Depends on:** nothing new — hardens the existing ingestion path. Small, high-value.

### P1-5 — Optional CAPTCHA
Per-form CAPTCHA (Cloudflare Turnstile or hCaptcha); verify the token server-side during
ingestion; surface the widget in the generated embeds.
- **Requirements:** FR-SPAM-4.
- **Depends on:** embed generation (done) for widget injection.

### P1-6 — Slack connector
OAuth install + channel picker (no pasted webhook URLs); chat-markup-safe formatting.
- **Requirements:** FR-CON-4, NFR-SEC-3 (chat-markup escaping).
- **Depends on:** F-C. New connector registered per D-007.

### P1-7 — Airtable connector
OAuth; populate base/table choices from Airtable's API; map definition fields → columns.
- **Requirements:** FR-CON-5.
- **Depends on:** F-C.

### P1-8 — Per-platform embed docs
Tier recommendation per platform + copy-paste guides for hand-coded, WordPress, Wix, and
Squarespace; validates breadth metric M-3.
- **Requirements:** FR-DOC-2, FR-EMB-7.
- **Depends on:** P1-2, P1-3 (documents the shipped tiers). Written last.

## Suggested sequence & rationale

1. **F-A, F-B** (foundations) → **P1-4** (cheap hardening) → **P1-1** (builder; the headline
   non-technical surface) → **P1-3** (iframe; builder-audience embed) → **P1-2** (JS snippet)
   → **P1-5** (CAPTCHA).
2. **F-C → P1-6 → P1-7** (connectors) can proceed in parallel with the embed work.
3. **P1-8** (docs) last, once the tiers exist.

Re-verify Wix/Squarespace iframe behavior periodically (R-1). None of these require Phase 0
schema changes; they extend the dashboard, embeds, connectors, and ingestion guards.
