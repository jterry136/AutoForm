# Contributing to AutoForm

Thanks for your interest. AutoForm is free and open source (MIT), built to be extended —
especially with **new connectors**, which are the most useful contribution you can make.

This guide gets you from a clone to a green test run, then explains the conventions a
reviewer will hold a pull request to. It deliberately **points at** the canonical documents
rather than restating them, so it can't drift out of sync with them:

| Document | What it is |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Working guide: tech stack, architectural invariants, conventions, project layout. |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Source of truth for requirements (FR-/NFR- IDs referenced throughout the code). |
| [MVP.md](MVP.md) | The Phase 0 scope checklist. |
| [DECISIONS.md](DECISIONS.md) | Running log of project-wide design decisions (D-001…). |
| [docs/](docs/) | User-facing docs: getting started, form fields, connectors. |

---

## 1. Before you write code

### Check the scope

AutoForm is built in phases (REQUIREMENTS.md §11). **CLAUDE.md carries a hard scope rule
naming the phase currently open for work** — read it first. Phases are build order, not
scope cuts: a deferred feature is still wanted, just not yet. If a change appears to need
something from a later phase, open an issue and confirm scope before building it.

Some things are **permanently out of scope** (REQUIREMENTS.md §4.2) and a PR implementing
one will be declined regardless of quality:

> payments and paid plans · conditional/branching logic · multi-step forms · file storage
> beyond basic attachment passthrough · white-label/custom-domain hosting · team/role
> management · a public connector marketplace

Anything near that line deserves an issue first.

### Check the constraints

Two of the project constraints (REQUIREMENTS.md §1.4) affect what a PR may contain:

- **C-1 (Cost).** AutoForm is free to run. Don't introduce a dependency or service that
  requires a paid plan to work. A connector for a paid product is fine — a *dependency* on
  a paid tier for the core to function is not.
- **C-5 (No employer reference).** No code, copy, branding, or design derived from the
  maintainer's current employer may appear anywhere in the project. This is a hard
  prohibition, not a preference.

### Open an issue first for anything non-trivial

Bug fixes and docs improvements can go straight to a PR. New features, schema changes, and
anything that touches ingestion, the delivery queue, or the connector contract should start
as an issue so the design can be agreed before you spend time on it.

---

## 2. Local setup

**Prerequisites:** Node **24+** and npm. **Docker** is needed only to run the integration
tests (see [§4](#4-testing)).

```bash
git clone https://github.com/jterry136/AutoForm.git
cd AutoForm
npm install
```

### Environment

```bash
cp .env.example .env
```

`src/lib/env.ts` is the contract — it validates the environment with ArkType on first
import and throws with a summary of what's missing. Currently:

| Variable | Required | How to get it |
|---|---|---|
| `DATABASE_URL` | yes | Any Postgres. For Supabase use the **Transaction pooler** URL (Dashboard → Project → Connect → ORMs / Drizzle); the client sets `prepare: false` for pooler compatibility. |
| `BETTER_AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | yes | Your app's base URL — `http://localhost:3000` in development. |
| `ENCRYPTION_KEY` | yes | A 32-byte key, base64-encoded: `openssl rand -base64 32`. Encrypts destination credentials at rest (D-004). |
| `RESEND_API_KEY` | no | [Resend API key](https://resend.com/api-keys). Only needed to exercise the email connector. |

Never commit a real secret, and never edit `.env` expecting it to be tracked — it is
gitignored. If you add a variable, add it to **all three** of `src/lib/env.ts`,
`.env.example`, and the docs in the same PR.

### Database and dev server

```bash
npm run db:migrate   # apply migrations to DATABASE_URL
npm run dev          # http://localhost:3000
```

Migrations are **generated, never hand-written**: change `src/db/schema.ts`, then run
`npm run db:generate` and commit the generated SQL in `src/db/migrations/` alongside the
schema change. `npm run db:studio` opens Drizzle Studio if you want to poke at the data.

You do **not** need a populated `.env` to run the test suite — see below.

---

## 3. The verification gate

Every PR must be green on all of these. CI (`.github/workflows/ci.yml`) runs exactly this
sequence on `ubuntu-latest`, so running it locally first is the fastest path to a clean
review:

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint .
npm run format:check   # prettier --check .
npm run build          # production build
npm test               # vitest run
```

Use `npm run format` to fix formatting rather than hand-matching Prettier's output.

A PR that fails the gate isn't ready for review. If something is failing for a reason
unrelated to your change, say so in the PR description rather than leaving the reviewer to
work it out.

---

## 4. Testing

Tests live **next to the module they cover**, not in a separate tree, and the filename
declares which kind they are:

| Pattern | Kind | Needs Docker |
|---|---|---|
| `*.unit.test.ts` | Pure logic — no database, no network. | No |
| `*.integration.test.ts` | Exercises the real pipeline against real Postgres. | Yes |

`test/global-setup.ts` starts a throwaway `postgres:16-alpine` container on a fixed port,
applies the project's migrations to it (which also validates the migration SQL), and
removes it afterward. `vitest.config.ts` injects the environment the tests need, so
**`npm test` works on a fresh clone with no `.env` at all** — it never touches a real
database. If Docker isn't running you'll get a clear error telling you so.

Integration test files run serially and share one database, so **each file resets the
tables it uses**. Follow that pattern; helpers live in `test/helpers.ts`.

What to test:

- New pure logic (validation, normalization, serialization, spam checks) → unit tests.
- Anything ownership-scoped, queued, or persisted → an integration test, including the
  **non-owner path**. "A stranger cannot reach this" is a claim that needs a test.
- New connectors → unit tests for success, retryable failure, permanent failure, and
  sanitization. See `src/connectors/webhook.unit.test.ts` and `email.unit.test.ts`.

---

## 5. Conventions

The full set is in [CLAUDE.md](CLAUDE.md) — read it before your first PR. The ones that
most often come up in review:

- **TypeScript everywhere.** No plain `.js` app code.
- **ArkType, not Zod**, at every schema and validation boundary — form definitions, request
  bodies, environment variables.
- **Drizzle for all DB access.** No raw SQL in app code, no second query builder.
- **shadcn/ui via the CLI** (`npx shadcn@latest add <name>`) before hand-rolling markup
  (D-003). `src/components/ui/` is reserved for generated primitives — treat it as managed;
  custom components go in `src/components/`.
- **Lucide is the only icon library.**
- **Accessibility is a requirement, not a polish item** (NFR-A11Y-1/2): labels, focus, and
  error messaging meet WCAG 2.1 AA, and status is never conveyed by color alone.

Keep the ingestion path fast and side-effect-light: validate → persist → enqueue → respond.
Heavy work belongs in the worker.

---

## 6. Architectural invariants

REQUIREMENTS.md §5 defines five invariants (P-1…P-5), restated with their operational
consequences in CLAUDE.md. These are the things a PR gets **rejected** for, so they're worth
knowing before you write code rather than after:

| | Invariant | A PR is rejected if it… |
|---|---|---|
| **P-1** | The form definition is the single source of truth. | Duplicates the definition's field list somewhere else, or validates against anything other than the form's definition. |
| **P-2** | Secrets are server-side only. | Lets a credential reach the client — in a server-function return value, a server-rendered page, an embed, or the client bundle. Return explicit DTOs, never raw DB rows (D-008). |
| **P-3** | Delivery is asynchronous. | Calls a destination API from the ingestion request path. Persist and enqueue; the worker delivers. |
| **P-4** | Embedding is tiered. | Assumes one embed works everywhere, or ships a tier the current phase hasn't opened. |
| **P-5** | No submission is lost. | Attempts a delivery before the submission is persisted, or drops a failed delivery instead of retrying and dead-lettering it. |

Two supporting rules come up just as often:

- **Ownership lives in the query** (D-008). Dashboard data access takes a `userId` and
  enforces ownership in the `where` clause; server functions are thin wrappers that resolve
  the session. Never trust a `formId` from a request, and give a stranger the same generic
  not-found an unknown id would get — no existence oracle.
- **Sanitize submission content before it reaches a connector** (NFR-SEC-3). Submitted
  values are attacker-controlled: escape or neutralize them for the destination's format
  (email header injection, chat markup, spreadsheet formulas).

---

## 7. Adding a connector

Connectors are the intended extension point and are deliberately isolated (NFR-MAINT-1):
**adding one requires no changes to ingestion or the delivery core.** If your change needs
to touch either, that's a signal the contract is wrong — raise it in the issue.

The contract is `src/connectors/types.ts`:

```ts
deliver(input: { payload, config, credentials }) => Promise<DeliveryOutcome>
validateConfig?(config) => { ok, error? }   // optional, used at setup time
```

The essentials:

1. **`deliver` must not throw for normal failures.** It returns a structured
   `DeliveryOutcome`. Throwing is for genuine programming errors.
2. **Classify failures correctly** (D-007). The queue obeys your `retryable` flag, so
   getting it wrong either hammers the destination or silently drops mail. Convention:
   transport/timeout errors and HTTP 408/429/5xx are retryable; other 4xx and
   missing/invalid config are not.
3. **Config vs credentials** (P-2, D-004). Non-secret settings go in `destination.config`;
   secrets are encrypted via `src/lib/crypto.ts` and decrypted by the worker at delivery
   time only.
4. **Sanitize for your destination's format** (NFR-SEC-3) — see `src/connectors/email.ts`
   for header-injection handling.
5. **Register it** in `src/connectors/index.ts`, document it in
   [docs/connectors.md](docs/connectors.md), and add unit tests.

`src/connectors/webhook.ts` is the smallest complete example.

---

## 8. Design decisions

[DECISIONS.md](DECISIONS.md) is the running log of **impactful, project-wide** decisions —
the "this is how we do things" calls that cut across the codebase. Routine library picks
belong in CLAUDE.md's stack table instead.

Add an entry (newest at top, next ID in sequence) when your change makes a decision that
would **surprise a new contributor, constrain future code, or override the requirements'
framing**. Use the existing format: ID, date, status, the decision, rationale, and
implications, linking the requirement or open question it resolves. Reflect any operational
rule it implies back into the relevant section of CLAUDE.md in the same PR.

If you're unsure whether a decision qualifies, it probably does — an entry that turns out
to be obvious costs a paragraph; an undocumented one costs the next contributor an hour.

---

## 9. Branches, commits, and pull requests

**Branches** are named for the chunk they implement: `phase/<chunk-id>-<short-slug>`, e.g.
`phase/p2-2-export-serializers`. Branch from `main`.

**Commits** describe what changed and why, in the imperative. Reference the requirement or
decision ID where it clarifies intent (`FR-SUB-4`, `D-007`). Keep unrelated changes in
separate commits — a formatting sweep mixed into a logic change makes review much harder.

**Pull requests** should say:

- What changed and why, linking the issue it closes.
- Which requirement IDs it satisfies, and any acceptance criteria from the issue.
- Anything you decided that the issue didn't specify, and any decision you deliberately
  deferred.
- The verification you actually ran — and honestly, what you *couldn't* run and why (no
  Docker, no database). Don't report a suite as green if you didn't run it.

Keep PRs scoped to one issue where you can. A reviewer will look hardest at the invariants
in [§6](#6-architectural-invariants), so calling out how your change respects them saves a
round trip.

---

## 10. License

AutoForm is [MIT licensed](LICENSE). By contributing, you agree that your contributions are
licensed under the same terms.
