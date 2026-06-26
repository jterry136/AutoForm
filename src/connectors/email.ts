import { Resend } from 'resend'
import { env } from '~/lib/env'
import type { DeliveryOutcome } from '~/lib/queue'
import type { Connector, ConnectorInput } from './types'

/**
 * Email connector via Resend (FR-CON-3). Config: `{ to, from?, subject? }`. The
 * Resend API key is an app-level secret (env.RESEND_API_KEY), not per-destination.
 *
 * NFR-SEC-3 (sanitization): header-bound fields (from/to/subject) are stripped of
 * CR/LF and control chars to prevent header injection, and the submission body is
 * HTML-escaped so submitted content cannot inject markup into the HTML part.
 */

const DEFAULT_FROM = 'AutoForm <onboarding@resend.dev>'
const DEFAULT_SUBJECT = 'New form submission'

/**
 * Strip CR/LF and other control chars from a value used in an email header,
 * collapsing the resulting whitespace. Uses char codes (not a control-char regex
 * literal) to keep the source free of embedded control characters.
 */
export function sanitizeHeaderValue(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ')
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Render the normalized submission as plain text + escaped HTML. */
export function renderSubmission(payload: Record<string, unknown>): {
  text: string
  html: string
} {
  const entries = Object.entries(payload)
  const text = entries.map(([k, v]) => `${k}: ${formatValue(v)}`).join('\n')
  const rows = entries
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 8px;font-weight:600">${escapeHtml(k)}</td>` +
        `<td style="padding:4px 8px">${escapeHtml(formatValue(v))}</td></tr>`,
    )
    .join('')
  return {
    text,
    html: `<table style="border-collapse:collapse">${rows}</table>`,
  }
}

function recipients(raw: unknown): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(',')
      : []
  return list
    .map((v) => sanitizeHeaderValue(String(v)))
    .filter((v) => v.length > 0)
}

export const emailConnector: Connector = {
  type: 'email',

  validateConfig(config) {
    if (recipients(config.to).length === 0) {
      return { ok: false, error: 'Email requires at least one "to" address.' }
    }
    if (!env.RESEND_API_KEY) {
      return {
        ok: false,
        error: 'RESEND_API_KEY is not configured on the server.',
      }
    }
    return { ok: true }
  },

  async deliver({ payload, config }: ConnectorInput): Promise<DeliveryOutcome> {
    const apiKey = env.RESEND_API_KEY
    if (!apiKey) {
      return {
        ok: false,
        retryable: false,
        error: 'RESEND_API_KEY is not configured on the server.',
      }
    }

    const to = recipients(config.to)
    if (to.length === 0) {
      return {
        ok: false,
        retryable: false,
        error: 'Email destination has no "to" address configured.',
      }
    }

    const from = sanitizeHeaderValue(
      typeof config.from === 'string' && config.from
        ? config.from
        : DEFAULT_FROM,
    )
    const subject = sanitizeHeaderValue(
      typeof config.subject === 'string' && config.subject
        ? config.subject
        : DEFAULT_SUBJECT,
    )
    const { text, html } = renderSubmission(payload)

    try {
      const resend = new Resend(apiKey)
      const { data, error } = await resend.emails.send({
        from,
        to,
        subject,
        text,
        html,
      })
      if (error) {
        const status = error.statusCode ?? undefined
        const retryable =
          status === 429 || (typeof status === 'number' && status >= 500)
        return {
          ok: false,
          retryable,
          error: `Resend error (${error.name}): ${error.message}`,
          responseStatus: status,
        }
      }
      return {
        ok: true,
        responseBody: data?.id ? `resend id ${data.id}` : 'sent',
      }
    } catch (err) {
      return {
        ok: false,
        retryable: true, // transport failure — transient
        error: `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  },
}
