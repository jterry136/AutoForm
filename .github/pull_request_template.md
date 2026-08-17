<!--
Thanks for contributing to AutoForm! Fill in the sections below.
See CONTRIBUTING.md for setup and conventions. Delete any section that doesn't apply.
-->

## What & why

<!-- What does this change do, and which issue does it close? -->

Closes #

## Verification

- [ ] `npm run typecheck` is green
- [ ] `npm run lint` is green
- [ ] `npm test` is green
- [ ] `npm run format` has been run

## Scope & conventions

- [ ] Stays within the current allowed scope (no REQUIREMENTS.md §4.2 out-of-scope work)
- [ ] Follows the stack conventions (TypeScript; **ArkType, not Zod**; **Drizzle**, no raw SQL;
      shadcn/ui via the CLI; Lucide icons)
- [ ] Respects architectural invariants P-1…P-5 (form definition is source of truth; secrets
      server-side only; delivery is async; embedding is tiered; no submission is lost)
- [ ] Recorded any project-wide design decision in `DECISIONS.md`

## Adding a connector?

<!-- Delete this section if the PR does not add a connector. -->

- [ ] Registered in `src/connectors/index.ts` with a unique `type` key; ingestion and the
      delivery core are unchanged (NFR-MAINT-1)
- [ ] Documented in `docs/connectors.md` (config table + retry semantics)
- [ ] Config validated with an **ArkType** schema; the inferred type is derived from it
- [ ] Retry classification correct — transient failures (`network`/`408`/`429`/`5xx`) are
      `retryable: true`; client errors (other `4xx`, invalid config) are `retryable: false`;
      `deliver` never throws for a normal failure
- [ ] Submission content sanitized against injection (NFR-SEC-3)
- [ ] Secrets server-side only (P-2): credentials arrive decrypted as `input.credentials`,
      are never logged in `error`/`responseBody`, and never reach the client
- [ ] No paid-tier-only dependency (C-1)
- [ ] Unit test added (`*.unit.test.ts`) covering success, retryable failure, permanent
      failure, and sanitization
