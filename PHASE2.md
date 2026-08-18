# PHASE2.md — Phase 2 chunk plan and progress

**Status: in progress — Phase 2 is the current allowed scope.** Phase 0 (MVP) is complete
and is what runs on `main`. Phase 2 — "polish and reach" (REQUIREMENTS.md §11) — is being
built now. Phase 1 (visual builder, iframe/JS-snippet tiers, Slack/Airtable connectors,
origin checks, CAPTCHA) is **planning only** and has not been started; see
[PHASE1.md](PHASE1.md).

Phase 2 runs ahead of Phase 1 deliberately: every Phase 2 chunk below extends the existing
core (ingestion, queue, dashboard, docs) and none of them need a Phase 1 surface.

> **Reading the issues.** Some Phase 2 issue bodies were written against a projected
> future state and reference artefacts that do not exist yet — `src/connectors/slack.ts`,
> `src/lib/oauth/providers/*`, "the four shipped connectors", and decision IDs above
> D-010. Two connectors ship today (webhook, email) and [DECISIONS.md](DECISIONS.md) ends
> at D-010. Treat those references as forward-looking, not as missing work.

**Last reviewed:** 2026-08-18, against `main` @ `8d0d188`.

## Progress

**Landed on `main`: 3 of 16 issues** — P2-2a, P2-4a, P2-6c. No chunk is complete end to
end yet.

| Chunk | Scope | Requirements | Status |
|---|---|---|---|
| **P2-1** | Manual replay | FR-DEL-5 | Not started — no issue yet |
| **P2-2** | Submission export | FR-SUB-4 | In progress — 1 of 3 landed |
| **P2-3** | Configurable retention | FR-SUB-3, NFR-PRIV-1/2 | In progress — 0 of 5 landed |
| **P2-4** | Delivery-health notifications | FR-NOTIF-1 | In progress — 1 of 3 landed |
| **P2-5** | Self-hosting docs | FR-DOC-6 | In progress — 0 of 2 landed |
| **P2-6** | Contributor guide + connector pathway | FR-DOC-4, FR-CON-7 | In progress — 1 of 3 landed |
| **P2-7** | Starter templates | FR-FB-6 | Blocked on Phase 1 (the builder) |

A chunk is ticked below only when its work is **merged to `main`** — an open pull request
is not "done". Tick the chunk line and the progress count in the same PR that lands the
work, per the acceptance criteria on the issues that own the bookkeeping (P2-2c, P2-4c,
P2-6c).

## Chunks

### P2-1 — Manual replay
Let an owner re-run a failed or dead-lettered delivery from the dashboard, reusing the
stored submission rather than asking the sender to submit again.
- **Requirements:** FR-DEL-5 (Should).
- **Depends on:** D-006 (the `delivery_attempt` row-per-attempt queue is already the audit
  log a replay would append to).
- **Status:** [ ] not started. No issue is open for it and `src/lib/replay.ts` does not
  exist, though the retention issues (P2-3d) already assume it. Interacts with retention:
  a purged or zero-retention submission cannot be replayed.

### P2-2 — Submission export
CSV/JSON export of a form's submissions, from serializer through download endpoint to the
inbox control.
- **Requirements:** FR-SUB-4 (Should). **Depends on:** D-005, D-008.
- [x] **P2-2a** (#1) — export serializers + column derivation (`src/lib/export.ts`).
      Landed in #17.
- [ ] **P2-2b** (#2) — ownership-scoped export query + authenticated download endpoint.
- [ ] **P2-2c** (#3) — inbox export controls (CSV/JSON), docs, and this chunk's
      bookkeeping (a DECISIONS.md entry for the export decisions).

### P2-3 — Configurable retention
Per-form retention policy, the purge pass that enforces it, zero-retention, and the manual
deletion tooling a data-subject request needs. The one chunk that needs its policy settled
before code — R-3 flags retention defaults as load-bearing.
- **Requirements:** FR-SUB-3 (Should), NFR-PRIV-1 (Must), NFR-PRIV-2 (Should).
  **Resolves:** open question **Q-3**. **Constrained by:** P-5 (persist before delivery).
- [ ] **P2-3a** (#4) — settle Q-3: default retention period + zero-retention semantics
      (decision only; DECISIONS.md, REQUIREMENTS.md §12, MVP.md, CLAUDE.md).
- [ ] **P2-3b** (#5) — schema, generated migration, `setRetentionFn`, settings UI.
- [ ] **P2-3c** (#6) — batched purge worker (`src/lib/retention.ts`), started alongside the
      delivery worker per D-006.
- [ ] **P2-3d** (#7) — zero-retention ingestion/delivery path; inbox, export, and replay
      degrade to an explicit "not retained" state.
- [ ] **P2-3e** (#8) — manual submission deletion tooling (single + all), NFR-PRIV-2.

### P2-4 — Delivery-health notifications
Detect a destination that is failing repeatedly, mail the owner once, and surface the state
in the dashboard.
- **Requirements:** FR-NOTIF-1 (Should), NFR-OBS-1. **Depends on:** D-006, D-007.
  **Decision:** D-010 (consecutive dead-letters, persisted de-duplication).
- [x] **P2-4a** (#9) — failure threshold + persisted de-duplication (`destination_health`,
      injectable notifier). Landed in #18.
- [ ] **P2-4b** (#10) — owner notification email via a system mailer (Resend), kept
      separate from the email *connector*.
- [ ] **P2-4c** (#11) — wire the notifier into the worker, dashboard health badge, opt-out,
      docs, and this chunk's bookkeeping.

### P2-5 — Self-hosting docs
Everything a developer needs to run their own instance, and an environment reference that
matches the code.
- **Requirements:** FR-DOC-6 (Should). **Docs only.**
- [ ] **P2-5a** (#12) — write `docs/self-hosting.md` (clone → env → migrate → run,
      including the in-process worker model and its operational consequences).
- [ ] **P2-5b** (#13) — environment-variable reference audit: `src/lib/env.ts`,
      `.env.example`, and the docs must agree, with startup-fatal vs feature-disabling
      stated per variable.

### P2-6 — Contributor guide + community-connector pathway
Make an outside connector contribution possible without reading the delivery core.
- **Requirements:** FR-DOC-4 (**Must**), FR-CON-7 (Could), FR-DOC-3. **Constraint:** C-2.
- [ ] **P2-6a** (#14) — add `CONTRIBUTING.md` (currently missing; FR-DOC-4 is a Must).
- [ ] **P2-6b** (#15) — connector authoring guide: the contract, retry classification
      (D-007), config vs credentials (P-2/D-004), sanitization (NFR-SEC-3), testing.
- [x] **P2-6c** (#16) — annotated connector template (`src/connectors/_template.ts`, kept
      unregistered), its test skeleton, the connector PR checklist, and the GitHub
      issue/PR templates. Landed in #27; this file and the README status line are its
      remaining close-out.

### P2-7 — Starter templates
A small set of starter forms (contact, signup, feedback) offered when creating a form.
- **Requirements:** FR-FB-6 (Could).
- **Status:** [ ] blocked. REQUIREMENTS.md §11 lists templates under Phase 2, but FR-FB-6
  scopes them to the **visual builder**, which is Phase 1 (P1-1). Build them with the
  builder, not before it.

## Sequence & rationale

1. **P2-3a first** — the retention decision gates P2-3b/c/d and is referenced by P2-2 and
   the replay work. Decisions before schema.
2. **P2-2 and P2-4** can proceed in parallel with retention: export touches the inbox data
   layer, notifications touch the queue's terminal path, and neither collides with the
   other.
3. **P2-3b → P2-3c → P2-3d** in order (schema, then the purge that uses it, then the
   zero-retention path that builds on both). **P2-3e** is independent of that ordering.
4. **P2-1 (manual replay)** wants the retention semantics settled first, so a replay of a
   purged submission has a defined answer. Open an issue for it before starting.
5. **P2-5 and P2-6** (docs) last within their chunks — self-hosting docs should describe
   the retention purge pass once it exists, and the connector guide should describe the
   connectors that actually ship.

## Not in Phase 2

- **FR-NOTIF-2** (optional email digest of recent submissions, Could) — not pulled into
  any chunk; open an issue if it is wanted.
- **Phase 1 features** — see [PHASE1.md](PHASE1.md). Do not build them under a Phase 2
  issue.
- **REQUIREMENTS.md §4.2 non-goals** are permanently out of scope in every phase
  (payments, branching logic, multi-step forms, white-label hosting, team/role management,
  a connector marketplace).
