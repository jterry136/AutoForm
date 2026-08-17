# Writing a connector

A guide for contributors adding a new destination to AutoForm. It covers the whole path —
contract, retry classification, secrets, registration, dashboard configuration,
sanitization, and tests — so you can ship a destination **without reading the delivery
core**. For using the connectors that already exist, see [connectors.md](connectors.md).

**Contents**

1. [Where a connector sits](#1-where-a-connector-sits)
2. [The contract](#2-the-contract)
3. [Writing `deliver`](#3-writing-deliver)
4. [Retry classification](#4-retry-classification)
5. [Config vs. credentials](#5-config-vs-credentials)
6. [Sanitizing submitted content](#6-sanitizing-submitted-content)
7. [Registering the connector](#7-registering-the-connector)
8. [Dashboard configuration UI](#8-dashboard-configuration-ui)
9. [Testing](#9-testing)
10. [Before you open the PR](#10-before-you-open-the-pr)
11. [Not yet available](#11-not-yet-available)

---

## 1. Where a connector sits

Ingestion and delivery are separate. `POST /f/{formId}` validates the submission, persists
it, enqueues one `delivery_attempt` row per **enabled** destination, and returns
immediately (P-3, P-5). The in-process worker (`src/lib/queue.ts`) then drains that queue:
it claims a due attempt, loads the submission and destination, decrypts the destination's
credential, and calls a single injected `DeliveryDispatcher`.

```
POST /f/{id} ──▶ validate ──▶ persist ──▶ enqueue ──▶ 200 / redirect
                                             │
                          worker poll ◀──────┘
                                 │  claim + load + decrypt
                                 ▼
                        dispatchDelivery(context)      src/connectors/index.ts
                                 │  routes on destination.type
                                 ▼
                        connector.deliver(input)       your file
                                 │  DeliveryOutcome
                                 ▼
                   record attempt · retry with backoff · dead-letter
```

The delivery core treats connectors as **opaque** (REQUIREMENTS.md §9,
[DECISIONS.md](../DECISIONS.md) D-007). Everything above the dotted line is done for you;
your connector is one pure-ish function from a prepared input to a structured outcome. Two
consequences worth internalizing:

- **Adding a connector never edits ingestion or the queue** (NFR-MAINT-1). If your change
  needs a queue change, something is wrong with the design — open an issue first.
- **The queue owns retry, backoff, and dead-lettering.** Your connector never sleeps,
  never loops, and never re-sends. It reports what happened; the queue decides what to do
  about it (D-006: one row per attempt, up to 5 attempts, exponential backoff with jitter,
  then `dead_letter`).

## 2. The contract

Everything you must implement is in [`src/connectors/types.ts`](../src/connectors/types.ts):

```ts
export type ConnectorInput = Pick<DeliveryContext, 'payload' | 'config' | 'credentials'>

export interface Connector {
  /** Destination type key this connector handles (e.g. 'webhook', 'email'). */
  readonly type: string
  /** Perform the destination-specific call. Must not throw for normal failures. */
  deliver(input: ConnectorInput): Promise<DeliveryOutcome>
  /** Optional setup-time validation (FR-CON-6), used by the dashboard. */
  validateConfig?(config: Record<string, unknown>): ConfigCheckResult
}
```

**What you receive** (`ConnectorInput`):

| Field | Type | What it is |
|---|---|---|
| `payload` | `Record<string, unknown>` | The **normalized** submission — the field names and values that passed validation against the form definition (P-1). Untrusted content: see [§6](#6-sanitizing-submitted-content). |
| `config` | `Record<string, unknown>` | The destination's non-secret settings, straight from the `destination.config` JSONB column. Persisted, so it may predate your current schema — re-validate it. |
| `credentials` | `string \| null` | The per-destination secret, **already decrypted** by the worker, or `null` when the destination has none. |

**What you return** (`DeliveryOutcome`, defined in `src/lib/queue.ts`):

```ts
type DeliveryOutcome =
  | { ok: true; responseStatus?: number; responseBody?: string }
  | { ok: false; retryable: boolean; error: string
      responseStatus?: number; responseBody?: string }
```

`error`, `responseStatus`, and `responseBody` are **persisted on the attempt row** and shown
in the dashboard, so make them diagnostic — and keep secrets out of them (see
[§5](#5-config-vs-credentials)). Bodies are truncated by the queue, but truncate your own
preview too; the shipped connectors cap at 1 000 characters.

**`deliver` must not throw for a normal failure.** A destination being down, rate-limiting
you, or rejecting your payload are all *expected* outcomes — return them as
`{ ok: false, retryable }`. Wrap `fetch` and SDK calls in `try/catch` and convert. (A thrown
error is caught by the worker and recorded as a retryable failure, but you lose all the
context that makes an attempt row useful.)

**`validateConfig` is optional but recommended.** It runs at setup time, before the
destination row is inserted, so misconfiguration surfaces in the dialog instead of as a
dead-lettered submission an hour later. Keep it cheap and side-effect-free — no live
delivery, no network call.

## 3. Writing `deliver`

The shape every connector follows, from
[`src/connectors/webhook.ts`](../src/connectors/webhook.ts):

```ts
export const webhookConnector: Connector = {
  type: 'webhook',

  async deliver({ payload, config, credentials }: ConnectorInput): Promise<DeliveryOutcome> {
    // 1. Re-validate persisted config. Structurally invalid → permanent failure;
    //    no number of retries will fix a missing URL.
    const url = getUrl(config)
    if (!url) {
      return { ok: false, retryable: false, error: 'Webhook destination has no "url" configured.' }
    }

    // 2. Build the request. Secrets come from `credentials`, never from `config`.
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (credentials) headers.authorization = `Bearer ${credentials}`

    // 3. Call the destination — always with a timeout, always inside try/catch.
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS), // 10s in the shipped connectors
      })
    } catch (err) {
      // Network error / timeout — transient.
      return { ok: false, retryable: true, error: `Webhook request failed: ${message(err)}` }
    }

    // 4. Map the response onto an outcome.
    const responseBody = await readPreview(res)
    if (res.ok) return { ok: true, responseStatus: res.status, responseBody }

    const retryable = res.status === 408 || res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      error: `Webhook responded with HTTP ${res.status}.`,
      responseStatus: res.status,
      responseBody,
    }
  },
}
```

Notes that generalize:

- **Always set a timeout.** The worker claims an attempt with a 60-second stale-lock
  window; a hung request stalls that slot. `AbortSignal.timeout()` is enough.
- **Prefer `fetch` over a vendor SDK** unless the SDK earns its weight. If you do use one
  (as [`email.ts`](../src/connectors/email.ts) uses `resend`), it must be a free-tier-
  compatible dependency (C-1), and you still own the error mapping.
- **Validate config with ArkType, not Zod** (project convention). Derive the config type
  from the schema — `typeof configSchema.infer` — rather than hand-writing a parallel
  interface, so the two cannot drift.
- **Stay stateless.** No module-level mutable state, no caching between deliveries. The
  worker may process several attempts concurrently in one tick.

## 4. Retry classification

This is the part reviewers look at hardest, because getting it wrong fails in two bad
directions: marking a permanent failure retryable hammers someone else's API for five
attempts, and marking a transient failure permanent silently dead-letters a real
submission. The convention is settled in [DECISIONS.md](../DECISIONS.md) D-007:

| Situation | `retryable` | Why |
|---|---|---|
| Network error, DNS failure, connection reset | `true` | Transient by nature. |
| Timeout (your `AbortSignal`, or HTTP `408`) | `true` | The destination may be slow right now. |
| `429 Too Many Requests` | `true` | Backoff is exactly the right response. |
| `5xx` | `true` | Destination-side fault. |
| `400`, `404`, `409`, `422` — malformed or rejected payload | `false` | The same bytes will be rejected again. |
| `401`, `403` — bad or revoked credential | `false` | Needs a human to fix the destination. |
| Missing / structurally invalid `config` | `false` | Cannot succeed until reconfigured. |
| Unknown destination type | `false` | Handled for you by the dispatcher. |

The queue applies exponential backoff (`2s · 2^(attempt-1)`, capped at 5 minutes, with
jitter) and dead-letters after 5 attempts. Nothing is ever dropped: a dead-lettered attempt
stays on the row with its final `error` for inspection (P-5, FR-DEL-2).

Two judgement calls come up repeatedly:

- **Partial success** (some recipients accepted, some rejected). Prefer reporting `ok: true`
  with the detail in `responseBody`, or splitting into one destination per recipient.
  Returning `retryable: true` would re-deliver to the recipients that already succeeded.
- **Ambiguous timeouts.** If the request timed out *after* the destination may have acted,
  a retry can duplicate the delivery. Retry anyway — at-least-once is the project's
  guarantee (P-5) — and note the duplicate risk in your connector's doc comment. If the
  destination supports an idempotency key, send one derived from the submission ID.

## 5. Config vs. credentials

Secrets are server-side only, encrypted at rest (P-2, [DECISIONS.md](../DECISIONS.md)
D-004). The split is not stylistic — it decides what ends up readable in the database and
what can leak into a client bundle.

| | Where it lives | Example |
|---|---|---|
| **Non-secret config** | `destination.config` (JSONB, plaintext) | Webhook URL, extra headers, email `to`/`from`/`subject`, channel or table name |
| **Per-destination secret** | `destination.encryptedCredentials` (AES-256-GCM blob) | Bearer token, API key issued to that one destination |
| **App-level secret** | `~/lib/env.ts`, validated at startup | `RESEND_API_KEY` — one key for the whole instance, not per destination |

The plumbing is already built, in both directions:

- **Write path** — `addDestinationForUser` in [`src/lib/destinations.ts`](../src/lib/destinations.ts)
  runs your `validateConfig`, then calls `encrypt()` on the submitted secret before the
  insert. Plaintext secrets never reach the database.
- **Read path** — the worker calls `decrypt()` when it loads the attempt and hands you the
  plaintext in `input.credentials`. That is the *only* moment a credential is in the clear.

Rules for connector authors:

- **Never put a secret in `config`.** `config` is stored in plaintext and is sent verbatim
  to the dashboard client; the credential blob is reduced to a `hasCredentials` boolean
  before it leaves the server (`getFormFn` in `src/lib/server-fns.ts`). Anything you put in
  `config` is visible in the browser.
- **Never put a secret in `error` or `responseBody`.** Those are persisted and displayed.
  Watch for destinations that echo your `Authorization` header back in an error body — if
  that is possible, redact before returning the preview.
- **Never log credentials**, and never re-encrypt or persist them yourself. The connector
  is stateless; it consumes the string and forgets it.
- **Never import a connector into client code.** Connectors are server-only: they reach
  `~/lib/env.ts` and vendor SDKs. Keep them out of anything a route component imports.

If your destination needs a secret that is neither per-destination nor per-instance — a
long-lived OAuth token with refresh, say — see [§11](#11-not-yet-available) before
inventing storage for it.

## 6. Sanitizing submitted content

Submission payloads are attacker-controlled: anybody who can see the form's public endpoint
can post arbitrary field names and values. Each connector is responsible for neutralizing
whatever its own destination format treats as syntax (NFR-SEC-3). The delivery core does
not sanitize for you — it cannot know what your destination parses.

The two shipped worked examples:

- **Header injection** — [`email.ts`](../src/connectors/email.ts) runs every header-bound
  value (`from`, `to`, `subject`) through `sanitizeHeaderValue()`, which replaces every
  character below `0x20` plus `0x7f` with a space and collapses runs of whitespace. Without
  it, a `subject` containing a CR/LF could append `Bcc:` headers.
- **Markup injection** — the same connector HTML-escapes every key and value rendered into
  the HTML part (`&`, `<`, `>`, `"`), so a submitted `<script>` is text, not markup.

Ask, for your destination: what characters change meaning here?

| Destination shape | Watch for |
|---|---|
| Email headers | CR, LF, other control characters |
| HTML / rich text | `&`, `<`, `>`, `"` |
| Chat (Slack-style mrkdwn) | `<`, `>`, `@`, `#` — link, mention, and channel syntax |
| CSV / spreadsheet cells | Leading `=`, `+`, `-`, `@`, TAB, CR (formula injection) |
| Shell, SQL, file paths | Don't. Nothing in a connector should build one from a payload. |

Two habits: escape at the boundary where the value is *rendered* into the destination's
format (not on the way in), and sanitize **keys as well as values** — field names come from
the same untrusted submission.

## 7. Registering the connector

One file. [`src/connectors/index.ts`](../src/connectors/index.ts):

```ts
import { emailConnector } from './email'
import { myConnector } from './mydest'   // ← add the import
import { webhookConnector } from './webhook'

const registry = new Map<string, Connector>(
  [webhookConnector, emailConnector, myConnector].map((c) => [c.type, c] as const),
)
```

That is the entire wiring. `dispatchDelivery` looks your connector up by
`destination.type`, and an unregistered type dead-letters with a clear message rather than
crashing the worker.

Your `type` key must be **unique and stable**: it is persisted on every `destination` row,
so renaming it later orphans existing destinations. Use a short lowercase identifier
(`webhook`, `email`, `slack`), matching the file name.

`connectorTypes()` returns the registered keys, for anything that needs to enumerate them.

## 8. Dashboard configuration UI

A registered connector is reachable by the worker but not yet *selectable* by an owner. The
add-destination dialog lives in
[`src/routes/dashboard/forms.$formId.tsx`](../src/routes/dashboard/forms.$formId.tsx)
(`AddDestinationDialog`) and needs two additions:

1. A `<SelectItem value="mydest">My destination</SelectItem>` in the type `Select`.
2. A block of fields shown when that type is selected, and a branch in `onSubmit` that
   assembles `config` (and the optional plaintext `secret`) from them.

Conventions that apply here:

- **shadcn/ui over hand-rolled markup** ([DECISIONS.md](../DECISIONS.md) D-003). Generate
  anything missing with `npx shadcn@latest add <name>`; icons come from **Lucide** only.
- **Every input needs a `<Label htmlFor>`** and a stable `id` (NFR-A11Y-2). Secret inputs
  use `type="password"`.
- **The secret goes in the `secret` field of the mutation, not into `config`** — that is
  what routes it through `encrypt()`.

Server-side, you get authorization for free and must not work around it: the dialog calls
`addDestinationFn`, a TanStack server function that resolves the session, then delegates to
`addDestinationForUser`, which verifies the caller owns the form before inserting
([DECISIONS.md](../DECISIONS.md) D-008 — every query is scoped by owner in the data layer,
not in the component). If your connector needs its own endpoint — a picker that lists
remote resources, say — it follows the same rule: a server function that takes the session
user and scopes every lookup by ownership. Never accept a form or destination ID from the
client and trust it.

## 9. Testing

Two levels, both already set up. `npm test` runs everything; the harness starts one
throwaway Postgres in Docker for the integration tests.

**Unit tests — `src/connectors/<type>.unit.test.ts`.** No database. Follow
[`webhook.unit.test.ts`](../src/connectors/webhook.unit.test.ts): spin up a
`node:http` server on port 0, point the connector's config at it, and assert on what
arrived and what came back. Cover, at minimum:

- **success** — a 2xx maps to `{ ok: true }`, and the request body/headers are what the
  destination expects;
- **retryable failure** — `429` and `5xx` return `retryable: true`, and so does a
  connection error (point at a dead port such as `http://127.0.0.1:1`);
- **permanent failure** — other `4xx` and missing/invalid config return
  `retryable: false`;
- **sanitization** — a payload containing your destination's syntax characters comes out
  neutralized;
- **`validateConfig`** — accepts a good config, rejects each way it can be wrong.

Connectors that call a vendor SDK instead of `fetch` have no local server to point at.
[`email.unit.test.ts`](../src/connectors/email.unit.test.ts) handles that by exporting the
pure pieces (`sanitizeHeaderValue`, `renderSubmission`) and testing them directly, plus the
failure paths that never reach the SDK (missing key, missing recipient, `validateConfig`).
Structure your connector the same way — keep formatting and sanitization in exported
helpers — or mock the SDK module with `vi.mock` and assert on the arguments it received.

**Integration test — [`dispatch.integration.test.ts`](../src/connectors/dispatch.integration.test.ts).**
This is the one that proves the wiring: it creates a form, adds a destination of the given
type via the real data layer, inserts a submission, calls `enqueueDeliveries` +
`runWorkerOnce(dispatchDelivery)`, and asserts the attempt row reached `succeeded` — plus
that a `5xx` marks the attempt `failed` and schedules a fresh `pending` row for attempt 2,
and that an unregistered destination type dead-letters instead of crashing the worker.
Adding a case for your type
here is the cheapest proof that registration, config storage, and credential decryption all
line up. Helpers (`createForm`, `addDestination`, `insertSubmission`, `resetDb`) live in
`test/helpers.ts`.

Then: `npm run typecheck`, `npm run lint`, `npm test`, `npm run format`.

## 10. Before you open the PR

- [ ] `src/connectors/<type>.ts` implements `Connector` with a unique, stable `type` key.
- [ ] Config validated with **ArkType**; the config type is inferred from the schema.
- [ ] `deliver` never throws for a normal failure and always sets a request timeout.
- [ ] Retry classification matches the table in [§4](#4-retry-classification).
- [ ] Secrets: per-destination in `credentials`, app-level in `~/lib/env.ts`, never in
      `config`, `error`, `responseBody`, logs, or client code.
- [ ] Submitted content sanitized for the destination's format (NFR-SEC-3).
- [ ] Registered in `src/connectors/index.ts`; ingestion and the queue are unchanged.
- [ ] Selectable in the add-destination dialog, with labelled, accessible inputs.
- [ ] Unit tests cover success / retryable / permanent / sanitization / `validateConfig`;
      an integration case exercises the dispatcher.
- [ ] Documented in [connectors.md](connectors.md) — config table + retry semantics.
- [ ] Works on the destination's free tier (C-1); no paid-only dependency.
- [ ] Any project-wide decision it forces is recorded in [DECISIONS.md](../DECISIONS.md).
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green.

## 11. Not yet available

**OAuth-based connections.** Today a connector authenticates with either a per-destination
credential or an app-level env secret. There is no shared, refreshable OAuth connection —
that plumbing (encrypted token storage, refresh at delivery time, a connection picker in
the dashboard) is planned as Phase 1 foundation **F-C** in [PHASE1.md](../PHASE1.md),
alongside the Slack and Airtable connectors that will be its first consumers. If your
destination only supports OAuth, open an issue before building storage for the tokens —
it should extend the connector contract in one place, not once per connector.

**Per-connector config schemas in the dashboard.** Config fields are currently hand-written
per type in the add-destination dialog. Driving that form from each connector's ArkType
schema is a natural follow-up; until then, adding a connector means touching the dialog.
