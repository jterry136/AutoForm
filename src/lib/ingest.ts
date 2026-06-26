import { createHash } from 'node:crypto'
import { type } from 'arktype'
import { db } from '~/db'
import { submission } from '~/db/schema'
import { enqueueDeliveries } from '~/lib/queue'
import {
  formDefinitionSchema,
  REDIRECT_FIELD,
  validateSubmission,
  type SubmissionError,
} from '~/lib/validation'

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
  | { status: 'invalid'; errors: SubmissionError[] }
  | { status: 'not_found' }
  | { status: 'unsupported_media' }
  | { status: 'misconfigured' }

/** Parse urlencoded body, collapsing repeated keys into arrays (multi-value). */
function parseUrlEncoded(body: string): Record<string, unknown> {
  const params = new URLSearchParams(body)
  const out: Record<string, unknown> = {}
  for (const key of new Set(params.keys())) {
    const all = params.getAll(key)
    out[key] = all.length > 1 ? all : (all[0] ?? '')
  }
  return out
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
  const rawBody = await request.text()

  // Parse the body into raw key-values by content type (FR-ING-1/2).
  let raw: Record<string, unknown>
  if (contentType.includes('application/json')) {
    try {
      const parsed: unknown = JSON.parse(rawBody || '{}')
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        return {
          status: 'invalid',
          errors: [
            { field: '', message: 'Request body must be a JSON object' },
          ],
        }
      }
      raw = parsed as Record<string, unknown>
    } catch {
      return {
        status: 'invalid',
        errors: [{ field: '', message: 'Invalid JSON body' }],
      }
    }
  } else if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType === ''
  ) {
    raw = parseUrlEncoded(rawBody)
  } else {
    // multipart/file uploads are deferred (FR-ING-6).
    return { status: 'unsupported_media' }
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

  // Control fields: resolve the redirect target and strip the honeypot before
  // validation (honeypot *enforcement* is Chunk 7; here it's just excluded so it
  // doesn't trip unknown-field rejection).
  const redirectRaw = raw[REDIRECT_FIELD]
  const redirectTarget =
    typeof redirectRaw === 'string' && redirectRaw.length > 0
      ? redirectRaw
      : (formRow.redirectUrl ?? null)
  delete raw[formRow.honeypotField]

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
