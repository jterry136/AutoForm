# DECISIONS.md — AutoForm

A running log of **impactful, project-wide design decisions** — the "this is how we do
things" calls, not routine "which library" picks. Each entry is short and high-level: the
decision, why, and what it implies. Newest at the top.

> When you make a decision of this kind, **add an entry here** and reflect any operational
> rule it implies in [CLAUDE.md](CLAUDE.md). Tech-stack picks live in CLAUDE.md's stack
> table; this file is for cross-cutting principles and policies.

---

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
