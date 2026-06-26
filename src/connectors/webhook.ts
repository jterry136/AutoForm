import type { DeliveryOutcome } from '~/lib/queue'
import type { Connector, ConnectorInput } from './types'

/**
 * Generic webhook connector (FR-CON-2): POST the normalized submission as JSON to
 * a user-supplied URL. Config: `{ url, headers? }`. An optional per-destination
 * credential is sent as a Bearer token.
 *
 * Retry classification (D-006/D-007): network/timeout and 408/429/5xx are
 * retryable; other 4xx are client errors that won't fix on retry.
 */

const TIMEOUT_MS = 10_000
const RESPONSE_PREVIEW_LIMIT = 1_000

function getUrl(config: Record<string, unknown>): string | null {
  const url = config.url
  return typeof url === 'string' && url.length > 0 ? url : null
}

async function readPreview(res: Response): Promise<string | undefined> {
  try {
    return (await res.text()).slice(0, RESPONSE_PREVIEW_LIMIT)
  } catch {
    return undefined
  }
}

export const webhookConnector: Connector = {
  type: 'webhook',

  validateConfig(config) {
    const url = getUrl(config)
    if (!url) return { ok: false, error: 'Webhook requires a "url".' }
    try {
      const { protocol } = new URL(url)
      if (protocol !== 'http:' && protocol !== 'https:') {
        return { ok: false, error: 'Webhook "url" must be http(s).' }
      }
    } catch {
      return { ok: false, error: 'Webhook "url" is not a valid URL.' }
    }
    return { ok: true }
  },

  async deliver({
    payload,
    config,
    credentials,
  }: ConnectorInput): Promise<DeliveryOutcome> {
    const url = getUrl(config)
    if (!url) {
      return {
        ok: false,
        retryable: false,
        error: 'Webhook destination has no "url" configured.',
      }
    }

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }
    if (credentials) headers.authorization = `Bearer ${credentials}`
    const extra = config.headers
    if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
      for (const [key, value] of Object.entries(
        extra as Record<string, unknown>,
      )) {
        if (typeof value === 'string') headers[key] = value
      }
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      return {
        ok: false,
        retryable: true, // network error / timeout — transient
        error: `Webhook request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }

    const responseBody = await readPreview(res)
    if (res.ok) {
      return { ok: true, responseStatus: res.status, responseBody }
    }

    const retryable =
      res.status === 408 || res.status === 429 || res.status >= 500
    return {
      ok: false,
      retryable,
      error: `Webhook responded with HTTP ${res.status}.`,
      responseStatus: res.status,
      responseBody,
    }
  },
}
