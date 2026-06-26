import { type Server, createServer } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { webhookConnector } from '~/connectors/webhook'

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

describe('webhookConnector (FR-CON-2)', () => {
  it('POSTs the normalized payload as JSON and reports success', async () => {
    const out = await webhookConnector.deliver({
      payload: { email: 'a@b.co', n: 2 },
      config: { url: baseUrl },
      credentials: null,
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.responseStatus).toBe(200)
    expect(received?.headers['content-type']).toContain('application/json')
    expect(JSON.parse(received!.body)).toEqual({ email: 'a@b.co', n: 2 })
  })

  it('sends a credential as a Bearer token', async () => {
    await webhookConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: 'sekret',
    })
    expect(received?.headers['authorization']).toBe('Bearer sekret')
  })

  it('classifies 4xx as a non-retryable failure', async () => {
    respondStatus = 400
    const out = await webhookConnector.deliver({
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
    const tooMany = await webhookConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: null,
    })
    expect(tooMany).toMatchObject({ ok: false, retryable: true })

    respondStatus = 503
    const unavailable = await webhookConnector.deliver({
      payload: {},
      config: { url: baseUrl },
      credentials: null,
    })
    expect(unavailable).toMatchObject({ ok: false, retryable: true })
  })

  it('treats a network/connection error as retryable', async () => {
    const out = await webhookConnector.deliver({
      payload: {},
      config: { url: 'http://127.0.0.1:1' }, // nothing listening
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: true })
  })

  it('fails non-retryably when no url is configured', async () => {
    const out = await webhookConnector.deliver({
      payload: {},
      config: {},
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: false })
  })

  it('validateConfig checks for a valid http(s) url', () => {
    expect(webhookConnector.validateConfig?.({ url: baseUrl }).ok).toBe(true)
    expect(webhookConnector.validateConfig?.({}).ok).toBe(false)
    expect(webhookConnector.validateConfig?.({ url: 'ftp://x' }).ok).toBe(false)
  })
})
