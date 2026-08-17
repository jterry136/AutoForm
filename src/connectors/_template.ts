import { type } from 'arktype'
import type { DeliveryOutcome } from '~/lib/queue'
import type { Connector, ConnectorInput } from './types'

/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  CONNECTOR TEMPLATE — copy this file to build a new destination connector.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * This is a REFERENCE, not a real destination: it is deliberately **not**
 * registered in `src/connectors/index.ts`, so it never appears as a selectable
 * destination type. The leading underscore in the filename keeps it grouped with
 * other scaffolding and signals "not a shipped connector".
 *
 * It implements a generic "notify" connector — POST a normalized submission as
 * JSON to a chat/webhook-style endpoint — because that shape exercises every
 * concern a real connector must handle. Read the numbered notes, then adapt.
 *
 * HOW TO USE THIS TEMPLATE
 *   1. Copy this file to `src/connectors/<yourtype>.ts` and drop the underscore.
 *   2. Copy `_template.unit.test.ts` to `<yourtype>.unit.test.ts` and adapt it.
 *   3. Rename the exported connector and set a unique `type` key.
 *   4. Replace the config schema, payload formatting, and the destination call.
 *   5. Register it in `src/connectors/index.ts` and document it in
 *      `docs/connectors.md`. Ingestion and the delivery queue need NO changes
 *      (NFR-MAINT-1) — the registry is the only wiring.
 *
 * The delivery core treats connectors as OPAQUE (REQUIREMENTS.md §9): the worker
 * loads the submission + destination, decrypts credentials (P-2), and hands you a
 * prepared {@link ConnectorInput}. You return a structured {@link DeliveryOutcome};
 * the queue decides retry/backoff/dead-letter from your `retryable` flag.
 */

// ─── (1) Config schema — validate with ArkType, never Zod (project convention) ─
//
// A connector owns its own config shape. Keep secrets OUT of config: per-
// destination credentials arrive separately as `input.credentials` (already
// decrypted). App-level secrets belong in `~/lib/env.ts`, read server-side only.
const configSchema = type({
  url: 'string > 0',
  'username?': 'string',
})

/** The parsed, trusted config shape derived from the schema (never duplicated). */
type TemplateConfig = typeof configSchema.infer

const TIMEOUT_MS = 10_000
const RESPONSE_PREVIEW_LIMIT = 1_000

/**
 * (2) SANITIZATION (NFR-SEC-3). Submitted content is untrusted. Guard the
 * injection vectors your destination is prone to — email connectors strip CR/LF
 * from header fields; chat connectors neutralize control chars and markup that
 * could spoof formatting or mentions. Here we strip control characters and defuse
 * the chat control glyphs `<`, `>`, `@` so a submission cannot forge a link,
 * mention, or command in the destination.
 */
function sanitizeText(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    if (code < 0x20 || code === 0x7f) {
      out += ' ' // drop control chars (incl. CR/LF)
    } else if (ch === '<' || ch === '>' || ch === '@') {
      out += ' ' // defuse chat markup / mention injection
    } else {
      out += ch
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Format the normalized submission into the destination's expected shape. */
function formatMessage(payload: Record<string, unknown>): string {
  return Object.entries(payload)
    .map(
      ([key, value]) => `${sanitizeText(key)}: ${sanitizeText(String(value))}`,
    )
    .join('\n')
}

async function readPreview(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, RESPONSE_PREVIEW_LIMIT)
  } catch {
    return undefined
  }
}

export const templateConnector: Connector = {
  // (3) A unique key. The registry routes by this; it must not collide with an
  // existing type. (This template is not registered, so nothing routes to it.)
  type: '_template',

  // (4) OPTIONAL setup-time check (FR-CON-6). The dashboard uses this to reject a
  // misconfigured destination before it is saved, so bad config never reaches the
  // queue. Keep it cheap and side-effect-free (no live delivery here).
  validateConfig(config) {
    const parsed = configSchema(config)
    if (parsed instanceof type.errors) {
      return { ok: false, error: parsed.summary }
    }
    try {
      const { protocol } = new URL(parsed.url)
      if (protocol !== 'http:' && protocol !== 'https:') {
        return { ok: false, error: 'URL must be http(s).' }
      }
    } catch {
      return { ok: false, error: 'URL is not valid.' }
    }
    return { ok: true }
  },

  // (5) deliver — perform the destination call. MUST NOT throw for a normal
  // failure: catch and return a structured outcome so the queue can classify it.
  async deliver({
    payload,
    config,
    credentials,
  }: ConnectorInput): Promise<DeliveryOutcome> {
    // Re-validate at the boundary: config is persisted and could predate a schema
    // change. A permanent (non-retryable) failure here is correct — retrying a
    // structurally invalid destination will never succeed.
    const parsed = configSchema(config)
    if (parsed instanceof type.errors) {
      return { ok: false, retryable: false, error: parsed.summary }
    }
    const { url, username }: TemplateConfig = parsed

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    // (6) SECRETS. `credentials` is the decrypted per-destination secret (P-2) or
    // null. Use it, but never put it in the outcome `error`/`responseBody` — those
    // are logged. Never re-encrypt or persist it; the connector is stateless.
    if (credentials) headers.authorization = `Bearer ${credentials}`

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ username, text: formatMessage(payload) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      // (7) RETRY CLASSIFICATION. Network errors and timeouts are transient →
      // retryable. The queue applies backoff and re-attempts.
      return {
        ok: false,
        retryable: true,
        error: `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    const responseBody = await readPreview(res)
    if (res.ok) {
      return { ok: true, responseStatus: res.status, responseBody }
    }

    // 408/429/5xx are transient (rate-limit / overload) → retryable. Other 4xx are
    // client errors that a retry cannot fix → permanent, and get dead-lettered.
    const retryable =
      res.status === 408 || res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      error: `Destination responded with HTTP ${res.status}.`,
      responseStatus: res.status,
      responseBody,
    }
  },
}
