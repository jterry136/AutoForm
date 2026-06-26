# Connectors

A **connector** delivers an accepted submission to a destination. The delivery core treats
connectors as opaque (see [DECISIONS.md](../DECISIONS.md) D-007): each owns its own config,
auth, and payload formatting. Delivery is asynchronous with automatic retries and
dead-lettering — a temporarily failing destination never loses a submission.

Add a destination from a form's page in the dashboard (**Destinations → Add**). Secrets you
enter are **encrypted at rest** and only decrypted at delivery time; they never reach the
browser.

The MVP ships two connectors.

## Webhook

POSTs the normalized submission to a URL you control as `application/json`.

| Config | Required | Notes |
|---|---|---|
| `url` | yes | `http(s)` URL that receives the POST. |
| `headers` | no | Extra request headers (object of string values). |
| Bearer token | no | Optional secret sent as `Authorization: Bearer <token>` (encrypted at rest). |

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

## Adding a connector (contributors)

Implement the `Connector` interface in `src/connectors/types.ts`:

```ts
deliver(input: { payload, config, credentials }) => Promise<DeliveryOutcome>
validateConfig?(config) => { ok, error? }   // optional, used at setup time
```

`deliver` decides whether a failure is `retryable` (the queue honors it). Register the
connector in `src/connectors/index.ts` — ingestion and the delivery queue need no changes
(NFR-MAINT-1). Slack and Airtable connectors are planned for Phase 1.
