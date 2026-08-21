import { createHash } from 'node:crypto'
import { type } from 'arktype'
import { db } from '~/db'
import { submission } from '~/db/schema'
import {
  MAX_BODY_BYTES,
  MAX_FIELD_COUNT,
  fieldValueTooLarge,
  readBodyCapped,
} from '~/lib/body-limits'
import { enqueueDeliveries } from '~/lib/queue'
import { checkRateLimit, isHoneypotTripped } from '~/lib/spam'
import {
  formDefinitionSchema,
  REDIRECT_FIELD,
  validateSubmission,
  type SubmissionError,
} from '~/lib/validation'

/**
 * Coarse per-IP cap across all forms (abuse guard, checked before the form
 * lookup). Per-form limits are configured on the form (rateLimitPerMinute).
 */
const PER_IP_GLOBAL_LIMIT = 300

/**
 * Ingestion core (Chunk 2): parse → look up form → validate against its
 * definition → persist (P-5) → enqueue delivery (P-3) → return a domain result.
 * The HTTP route layer maps the result to a response (redirect / JSON / HTML).
 *
 * No destination calls happen here — the path is validate → persist → enqueue →
 * return, so it stays fast (NFR-PERF-1).
 */
export type IngestResult =
  | { status: 'ok'; submissionId: string; redirectTarget: string | null }
  | { status: 'spam'; redirectTarget: string | null }
  | { status: 'rate_limited'; retryAfterSec: number }
  | { status: 'invalid'; errors: SubmissionError[] }
  | { status: 'not_found' }
  | { status: 'unsupported_media' }
  | { status: 'payload_too_large' }
  | { status: 'misconfigured' }

type ParsedFields = { ok: true; data: Record<string, unknown> } | { ok: false }

/** Parse urlencoded body, collapsing repeated keys into arrays (multi-value). */
function parseUrlEncoded(body: string): ParsedFields {
  const params = new URLSearchParams(body)
  if ([...params].length > MAX_FIELD_COUNT) return { ok: false }

  const out: Record<string, unknown> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    const value = all.length > 1 ? all : (all[0] ?? '')
    if (fieldValueTooLarge(value)) return { ok: false }
    out[key] = value
  }
  return { ok: true, data: out }
}

function clientIp(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return (xff.split(',')[0] ?? '').trim() || null
  return request.headers.get('x-real-ip')
}

/** Coarse, pseudonymous client fingerprint for abuse handling (NFR-PRIV). */
function fingerprint(request: Request): string | null {
  const ip = clientIp(request)
  if (!ip) return null
  const ua = request.headers.get('user-agent') ?? ''
  return createHash('sha256').update(`${ip}|${ua}`).digest('hex').slice(0, 32)
}

export async function ingestSubmission(
  request: Request,
  publicId: string,
): Promise<IngestResult> {
  const contentType = request.headers.get('content-type') ?? ''

  // Bound the raw read before anything else touches the body (a DoS guard —
  // the endpoint is public and unauthenticated, so an unbounded read is a
  // trivial memory-exhaustion vector; D-017).
  const bodyRead = await readBodyCapped(request, MAX_BODY_BYTES)
  if (!bodyRead.ok) return { status: 'payload_too_large' }
  const rawBody = bodyRead.text

  // Parse the body into raw key-values by content type (FR-ING-1/2).
  let raw: Record<string, unknown>
  if (contentType.includes('application/json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody || '{}')
    } catch {
      return {
        status: 'invalid',
        errors: [{ field: '', message: 'Invalid JSON body' }],
      }
    }
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {
        status: 'invalid',
        errors: [{ field: '', message: 'Request body must be a JSON object' }],
      }
    }
    const entries = Object.entries(parsed as Record<string, unknown>)
    if (
      entries.length > MAX_FIELD_COUNT ||
      entries.some(([, value]) => fieldValueTooLarge(value))
    ) {
      return { status: 'payload_too_large' }
    }
    raw = parsed as Record<string, unknown>
  } else if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType === ''
  ) {
    const parsed = parseUrlEncoded(rawBody)
    if (!parsed.ok) return { status: 'payload_too_large' }
    raw = parsed.data
  } else {
    // multipart/file uploads are deferred (FR-ING-6).
    return { status: 'unsupported_media' }
  }

  // Coarse per-IP guard before any DB work (FR-SPAM-2). A null IP (no proxy
  // headers, e.g. some test/local contexts) skips rate limiting.
  const ip = clientIp(request)
  if (ip) {
    const globalLimit = checkRateLimit(`ip:${ip}`, PER_IP_GLOBAL_LIMIT)
    if (!globalLimit.allowed) {
      return {
        status: 'rate_limited',
        retryAfterSec: globalLimit.retryAfterSec,
      }
    }
  }

  // Resolve the form by its public ID, with its definition + enabled
  // destinations (P-1: the definition is mandatory — D-001).
  const formRow = await db.query.form.findFirst({
    where: (f, { eq }) => eq(f.publicId, publicId),
    with: {
      definition: true,
      destinations: { where: (d, { eq }) => eq(d.enabled, true) },
    },
  })

  if (!formRow || formRow.status === 'disabled') return { status: 'not_found' }
  if (!formRow.definition) return { status: 'misconfigured' }

  const definition = formDefinitionSchema(formRow.definition.definition)
  if (definition instanceof type.errors) return { status: 'misconfigured' }

  // Resolve the redirect target up front — needed even for silently-rejected
  // spam, so a bot sees the same success response.
  const redirectRaw = raw[REDIRECT_FIELD]
  const redirectTarget =
    typeof redirectRaw === 'string' && redirectRaw.length > 0
      ? redirectRaw
      : (formRow.redirectUrl ?? null)

  // Honeypot (FR-SPAM-1): if the trap field is filled, silently reject — no
  // persist, no delivery — while returning a success-looking response.
  if (isHoneypotTripped(raw[formRow.honeypotField])) {
    return { status: 'spam', redirectTarget }
  }
  delete raw[formRow.honeypotField]

  // Per-form + per-IP rate limit (FR-SPAM-2).
  if (ip) {
    const formLimit = checkRateLimit(
      `form:${formRow.id}:ip:${ip}`,
      formRow.rateLimitPerMinute,
    )
    if (!formLimit.allowed) {
      return { status: 'rate_limited', retryAfterSec: formLimit.retryAfterSec }
    }
  }

  const result = validateSubmission(definition, raw)
  if (!result.ok) return { status: 'invalid', errors: result.errors }

  // Persist BEFORE any delivery (P-5 / NFR-REL-1).
  const [row] = await db
    .insert(submission)
    .values({
      formId: formRow.id,
      rawBody,
      contentType: contentType || null,
      normalizedPayload: result.data,
      referer: request.headers.get('referer'),
      userAgent: request.headers.get('user-agent'),
      clientFingerprint: fingerprint(request),
    })
    .returning({ id: submission.id })

  if (!row) return { status: 'misconfigured' }

  // Enqueue delivery to each enabled destination (P-3). A form with no
  // destinations still has its submission stored.
  await enqueueDeliveries(
    row.id,
    formRow.destinations.map((d) => d.id),
  )

  return { status: 'ok', submissionId: row.id, redirectTarget }
}
