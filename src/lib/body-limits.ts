/**
 * Body-size and field-shape caps for the public ingestion endpoint (D-017).
 * `POST /f/{formId}` is public and unauthenticated, so an unbounded
 * `request.text()` read is a trivial memory-exhaustion DoS. `MAX_BODY_BYTES`
 * bounds the raw read; `MAX_FIELD_COUNT` / `MAX_FIELD_VALUE_LENGTH` are a
 * secondary guard against a payload that is small in total bytes but
 * structurally excessive (many fields, or one huge value), independent of
 * the byte cap. Generous for real form data — a legitimate submission is
 * nowhere near these — but compile-time constants per the project's
 * convention for ingestion tunables (D-009), not env vars.
 *
 * Split out from `~/lib/ingest` so the streaming-cap behavior (does it
 * actually stop reading, or does it buffer everything first?) is unit
 * testable without a database.
 */

export const MAX_BODY_BYTES = 1_000_000 // 1 MB
export const MAX_FIELD_COUNT = 200
export const MAX_FIELD_VALUE_LENGTH = 100_000 // characters per value; ~100 KB of text

/**
 * Read a request body without ever buffering more than `maxBytes`. Checks
 * `content-length` up front to reject an oversized request without touching
 * the body at all, but does not trust that header alone (it can be absent,
 * or wrong for a streamed/chunked body) — the stream itself is read
 * incrementally and aborted the moment the cap is crossed, so a request
 * whose real content vastly exceeds `maxBytes` is never fully read into
 * memory regardless of what `content-length` claims.
 */
export async function readBodyCapped(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = Number(request.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    return { ok: false }
  }

  if (!request.body) {
    // No readable stream (e.g. a bodyless request, or a test double) — the
    // content-length check above already bounds this when the header is set.
    const text = await request.text()
    return text.length > maxBytes ? { ok: false } : { ok: true, text }
  }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    chunks.push(value)
  }

  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { ok: true, text: new TextDecoder().decode(combined) }
}

/** A value is too large for a control/data field regardless of overall body size. */
export function fieldValueTooLarge(value: unknown): boolean {
  if (typeof value === 'string') return value.length > MAX_FIELD_VALUE_LENGTH
  if (Array.isArray(value)) {
    return (
      value.length > MAX_FIELD_COUNT ||
      value.some(
        (v) => typeof v === 'string' && v.length > MAX_FIELD_VALUE_LENGTH,
      )
    )
  }
  return false
}
