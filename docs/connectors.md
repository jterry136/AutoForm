# Connectors

A **connector** delivers an accepted submission to a destination. The delivery core treats
connectors as opaque (see [DECISIONS.md](../DECISIONS.md) D-007): each owns its own config,
auth, and payload formatting. Delivery is asynchronous with automatic retries and
dead-lettering — a temporarily failing destination never loses a submission.

Add a destination from a form's page in the dashboard (**Destinations → Add**). Secrets you
enter are **encrypted at rest** and only decrypted at delivery time; they never reach the
browser.

The MVP ships two connectors. Building a new one? See
**[Writing a connector](connectors-authoring.md)** — the full authoring guide (contract,
retry classification, secrets, registration, sanitization, tests).

## Webhook

POSTs the normalized submission to a URL you control as `application/json`.

| Config | Required | Notes |
|---|---|---|
| `url` | yes | `http(s)` URL that receives the POST. Must resolve to a public address — see below. |
| `headers` | no | Extra request headers (object of string values). |
| Bearer token | no | Optional secret sent as `Authorization: Bearer <token>` (encrypted at rest). |

**`url` is checked against private/internal networks (NFR-SEC-1, [DECISIONS.md](../DECISIONS.md)
D-015).** Both when you add the destination and again on every delivery attempt (including
after each redirect), AutoForm resolves the hostname and refuses to deliver if it — or any
address it resolves to — is a loopback, private, link-local, or cloud-metadata address (e.g.
`169.254.169.254`). This closes an SSRF hole where a webhook URL could otherwise turn the
server into a proxy into its own network; there is no way to opt out of it.

**Request:** `POST <url>` with header `content-type: application/json` and a body that is the
normalized submission, e.g.:

```json
{ "email": "user@example.com", "message": "Hello" }
```

**Retries:** a `2xx` response is success. `408`, `429`, and `5xx` (and network/timeout
errors) are **retried** with backoff; other `4xx` are treated as permanent and dead-lettered.

## Email (Resend)

Emails the submission to one or more recipients via [Resend](https://resend.com). Requires
`RESEND_API_KEY` set on the server (app-level, not per-destination).

| Config | Required | Notes |
|---|---|---|
| `to` | yes | One address, or several comma-separated. |
| `from` | no | Sender address. Defaults to a Resend test sender; set a verified domain for production. |
| `subject` | no | Defaults to "New form submission". |

The email body lists each submitted field as plain text plus an HTML table. **Security:**
header fields (`from`/`to`/`subject`) are stripped of CR/LF and control characters to prevent
header injection, and submitted values are HTML-escaped in the HTML part (NFR-SEC-3).

**Retries:** Resend `429`/`5xx` and transport errors are retried; other API errors (e.g. an
invalid address) are permanent.

## When a destination keeps failing

Once a destination has dead-lettered several deliveries in a row it is flagged **Failing**
on the form's dashboard page and its owner is emailed once. See
[Notifications](notifications.md) for the thresholds, what the email contains, and the
per-form opt-out.

## Adding a connector (contributors)

Every connector implements one narrow interface from `src/connectors/types.ts`:

```ts
deliver(input: { payload, config, credentials }) => Promise<DeliveryOutcome>
validateConfig?(config) => { ok, error? }   // optional, used at setup time
```

`deliver` decides whether a failure is `retryable` (the queue honors it for backoff and
dead-lettering). Register the connector in `src/connectors/index.ts` — ingestion and the
delivery queue need no changes (NFR-MAINT-1).

### Start from the template

Rather than write one from scratch, copy the annotated reference connector and its test
skeleton:

- **[`src/connectors/_template.ts`](../src/connectors/_template.ts)** — a heavily commented
  connector showing the `Connector` shape, an ArkType-validated config, retryable-vs-permanent
  classification, submission sanitization (NFR-SEC-3), and secret handling. It is deliberately
  **not** registered, so it is never a selectable destination — copy it, drop the leading
  underscore, and adapt.
- **[`src/connectors/_template.unit.test.ts`](../src/connectors/_template.unit.test.ts)** — the
  matching unit-test skeleton (success, retryable failure, permanent failure, sanitization,
  `validateConfig`) built on a throwaway local HTTP server, so it needs no network or database.

```bash
cp src/connectors/_template.ts src/connectors/mydest.ts
cp src/connectors/_template.unit.test.ts src/connectors/mydest.unit.test.ts
# rename the export + `type` key, swap the config schema, payload, and destination call
```

### Connector PR checklist

Before opening a pull request for a new connector, confirm:

- [ ] **Registered** — added to the registry in `src/connectors/index.ts` with a unique `type`
      key; ingestion and the delivery core are unchanged (NFR-MAINT-1).
- [ ] **Documented** — a section added to this file (config table + retry semantics).
- [ ] **ArkType, not Zod** — config is validated with an ArkType schema; the inferred type is
      derived from it, not hand-duplicated.
- [ ] **Retry classification** — transient failures (network/timeout, `408`/`429`/`5xx`) return
      `retryable: true`; client errors (other `4xx`, invalid config) return `retryable: false`.
      `deliver` never throws for a normal failure.
- [ ] **Sanitized** — untrusted submission content cannot inject into the destination (header
      injection, chat markup/mentions, etc.), per NFR-SEC-3.
- [ ] **Secrets server-side only (P-2)** — per-destination credentials arrive already decrypted
      as `input.credentials`; app-level secrets come from `~/lib/env.ts`. Secrets are never put
      in `error`/`responseBody` (those are logged) and never reach the client.
- [ ] **No paid-tier-only dependency (C-1)** — the connector works against a free tier.
- [ ] **Tested** — a `*.unit.test.ts` covering success, retryable failure, permanent failure,
      and sanitization; `npm run typecheck`, `npm run lint`, and `npm test` are green.

Opening the PR from the repo's pull-request template surfaces this checklist automatically, and
the **New connector** issue template (`.github/ISSUE_TEMPLATE`) scopes the work up front.

> Every new destination — Slack, Airtable, or anything the community brings — follows exactly
> this pathway: implement the interface, register it, document it, test it.
