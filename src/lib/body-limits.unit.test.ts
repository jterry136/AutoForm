import { describe, expect, it } from 'vitest'
import {
  MAX_FIELD_VALUE_LENGTH,
  fieldValueTooLarge,
  readBodyCapped,
} from '~/lib/body-limits'

function requestWithBody(
  body: BodyInit,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/f/x', {
    method: 'POST',
    headers,
    body,
    // Node's fetch requires this for a streamed body.
    ...(body instanceof ReadableStream ? { duplex: 'half' } : {}),
  } as RequestInit)
}

describe('readBodyCapped', () => {
  it('reads a body under the cap', async () => {
    const result = await readBodyCapped(requestWithBody('hello=world'), 1_000)
    expect(result).toEqual({ ok: true, text: 'hello=world' })
  })

  it('rejects via content-length without ever acquiring a stream reader', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('x'))
        controller.close()
      },
    })
    const request = requestWithBody(stream, { 'content-length': '999999' })

    // Spy on the exact call our own code would have to make to start
    // consuming the stream. The platform's Request implementation may do
    // its own unrelated internal bookkeeping on the stream, so asserting on
    // that (e.g. whether the source's `pull` fired) would test undici, not
    // our short-circuit — this asserts our function's own control flow.
    let getReaderCalled = false
    const body = request.body!
    const originalGetReader = body.getReader.bind(body)
    body.getReader = ((...args: Parameters<typeof originalGetReader>) => {
      getReaderCalled = true
      return originalGetReader(...args)
    }) as typeof body.getReader

    const result = await readBodyCapped(request, 1_000)
    expect(result).toEqual({ ok: false })
    expect(getReaderCalled).toBe(false)
  })

  it('aborts a streamed body over the cap without buffering all of it', async () => {
    // 50 chunks of 100KB = 5MB total, far more than the 1KB cap. If this
    // reads the whole thing before checking, either the assertion below
    // fails (chunksServed stays at 50) or the test would hang on an
    // unbounded producer — neither happens with the real cap in place.
    const CHUNK_SIZE = 100_000
    const TOTAL_CHUNKS = 50
    let chunksServed = 0
    let cancelled = false
    const stream = new ReadableStream({
      pull(controller) {
        if (chunksServed >= TOTAL_CHUNKS) {
          controller.close()
          return
        }
        chunksServed++
        controller.enqueue(new Uint8Array(CHUNK_SIZE))
      },
      cancel() {
        cancelled = true
      },
    })
    const request = requestWithBody(stream) // no content-length: genuinely streamed

    const result = await readBodyCapped(request, 1_000)
    expect(result).toEqual({ ok: false })
    // The cap (1000 bytes) is crossed after the very first 100KB chunk, so
    // only a handful of pulls should have happened — nowhere near all 50.
    expect(chunksServed).toBeLessThan(TOTAL_CHUNKS)
    expect(cancelled).toBe(true)
  })

  it('accepts a streamed body exactly at the cap', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(500))
        controller.enqueue(new Uint8Array(500))
        controller.close()
      },
    })
    const result = await readBodyCapped(requestWithBody(stream), 1_000)
    expect(result.ok).toBe(true)
  })

  it('rejects a streamed body one byte over the cap', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(1_001))
        controller.close()
      },
    })
    const result = await readBodyCapped(requestWithBody(stream), 1_000)
    expect(result).toEqual({ ok: false })
  })

  it('decodes multi-byte UTF-8 correctly across the combined buffer', async () => {
    const text = '日本語のテキスト'
    const result = await readBodyCapped(requestWithBody(text), 1_000)
    expect(result).toEqual({ ok: true, text })
  })
})

describe('fieldValueTooLarge', () => {
  it('allows a string under the limit', () => {
    expect(fieldValueTooLarge('a'.repeat(MAX_FIELD_VALUE_LENGTH))).toBe(false)
  })

  it('rejects a string over the limit', () => {
    expect(fieldValueTooLarge('a'.repeat(MAX_FIELD_VALUE_LENGTH + 1))).toBe(
      true,
    )
  })

  it('rejects an array containing an over-limit string', () => {
    expect(
      fieldValueTooLarge(['ok', 'a'.repeat(MAX_FIELD_VALUE_LENGTH + 1)]),
    ).toBe(true)
  })

  it('rejects an array with too many entries', () => {
    expect(fieldValueTooLarge(Array(1000).fill('x'))).toBe(true)
  })

  it('allows non-string, non-array values (nothing to bound)', () => {
    expect(fieldValueTooLarge(42)).toBe(false)
    expect(fieldValueTooLarge(true)).toBe(false)
    expect(fieldValueTooLarge(undefined)).toBe(false)
  })
})
