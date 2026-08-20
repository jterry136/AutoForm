import { type Server, createServer } from 'node:http'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { templateConnector } from '~/connectors/_template'

/**
 * TEST SKELETON — copy alongside your connector as `<yourtype>.unit.test.ts`.
 *
 * Unit tests (`*.unit.test.ts`) do not touch the database. This one spins up a
 * throwaway local HTTP server so `deliver` runs against a real socket without any
 * network. Every connector should cover, at minimum:
 *   • success               — a 2xx maps to { ok: true }
 *   • retryable failure      — 408/429/5xx and network errors set retryable: true
 *   • permanent failure      — other 4xx (and invalid config) set retryable: false
 *   • sanitization (NFR-SEC-3) — untrusted content cannot inject into the payload
 *   • validateConfig         — accepts good config, rejects bad
 *
 * If your connector fetches a user-supplied URL, it should route through
 * `~/lib/ssrf-guard` (see the template). That guard's own private/loopback/
 * metadata-blocking logic is covered once, centrally, in
 * `~/lib/ssrf-guard.unit.test.ts` — mock it here (as below) so this file's
 * local test server (on loopback) isn't itself rejected by the guard, and add
 * a couple of unmocked tests like `webhook.ssrf.unit.test.ts` to prove your
 * connector is actually wired to it.
 */
vi.mock('~/lib/ssrf-guard', () => ({
  SsrfBlockedError: class SsrfBlockedError extends Error {},
  assertPublicHttpUrl: async (url: string) => {
    try {
      const { protocol } = new URL(url)
      if (protocol !== 'http:' && protocol !== 'https:') {
        return { ok: false, error: 'must be http(s)' }
      }
    } catch {
      return { ok: false, error: 'is not a valid URL' }
    }
    return { ok: true }
  },
  fetchPublicOnly: (url: string, init: RequestInit) => fetch(url, init),
}))

let server: Server
let baseUrl: string
let received: { body: string; headers: Record<string, unknown> } | null = null
let respondStatus = 200

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received = { body, headers: req.headers as Record<string, unknown> }
      res.statusCode = respondStatus
      res.end('response-body')
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  )
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(() => {
  received = null
  respondStatus = 200
})

describe('templateConnector (reference — not registered)', () => {
  it('POSTs the formatted payload as JSON and reports success', async () => {
    const out = await templateConnector.deliver({
      payload: { name: 'Ada', message: 'hi' },
      config: { url: baseUrl, username: 'bot' },
      credentials: null,
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.responseStatus).toBe(200)
    expect(received?.headers['content-type']).toContain('application/json')
    const sent = JSON.parse(received!.body)
    expect(sent.username).toBe('bot')
    expect(sent.text).toContain('name: Ada')
    expect(sent.text).toContain('message: hi')
  })

  it('sends a decrypted credential as a Bearer token', async () => {
    await templateConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: 'sekret',
    })
    expect(received?.headers['authorization']).toBe('Bearer sekret')
  })

  it('sanitizes control chars and chat markup out of the payload (NFR-SEC-3)', async () => {
    await templateConnector.deliver({
      payload: { message: 'line1\nline2 <@everyone>' },
      config: { url: baseUrl },
      credentials: null,
    })
    const text = JSON.parse(received!.body).text as string
    expect(text).not.toContain('\n')
    expect(text).not.toContain('<')
    expect(text).not.toContain('@')
  })

  it('classifies 4xx as a permanent (non-retryable) failure', async () => {
    respondStatus = 400
    const out = await templateConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: null,
    })
    expect(out).toMatchObject({
      ok: false,
      retryable: false,
      responseStatus: 400,
    })
  })

  it('classifies 429 and 5xx as retryable failures', async () => {
    respondStatus = 429
    const tooMany = await templateConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: null,
    })
    expect(tooMany).toMatchObject({ ok: false, retryable: true })

    respondStatus = 503
    const unavailable = await templateConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: null,
    })
    expect(unavailable).toMatchObject({ ok: false, retryable: true })
  })

  it('treats a network/connection error as retryable', async () => {
    const out = await templateConnector.deliver({
      payload: {},
      config: { url: 'http://127.0.0.1:1' }, // nothing listening
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: true })
  })

  it('fails permanently when config is invalid', async () => {
    const out = await templateConnector.deliver({
      payload: {},
      config: {},
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: false })
  })

  it('validateConfig accepts a valid http(s) url and rejects bad config', async () => {
    expect(
      (await templateConnector.validateConfig?.({ url: baseUrl }))?.ok,
    ).toBe(true)
    expect((await templateConnector.validateConfig?.({}))?.ok).toBe(false)
    expect(
      (await templateConnector.validateConfig?.({ url: 'ftp://x' }))?.ok,
    ).toBe(false)
  })
})
