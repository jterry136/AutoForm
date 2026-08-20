import { describe, expect, it } from 'vitest'
import { webhookConnector } from '~/connectors/webhook'

/**
 * End-to-end coverage that `webhookConnector` actually routes through the
 * real `~/lib/ssrf-guard` (unmocked, unlike `webhook.unit.test.ts`) and
 * refuses to deliver to a private/loopback/metadata address. The guard's own
 * range classification is exhaustively covered in
 * `~/lib/ssrf-guard.unit.test.ts`; this file only proves the wiring.
 */
describe('webhookConnector SSRF guarding', () => {
  it('validateConfig rejects a loopback url', async () => {
    const result = await webhookConnector.validateConfig?.({
      url: 'http://127.0.0.1:9999/webhook',
    })
    expect(result?.ok).toBe(false)
  })

  it('validateConfig rejects the cloud metadata url', async () => {
    const result = await webhookConnector.validateConfig?.({
      url: 'http://169.254.169.254/latest/meta-data/',
    })
    expect(result?.ok).toBe(false)
  })

  it('validateConfig rejects a private RFC1918 url', async () => {
    const result = await webhookConnector.validateConfig?.({
      url: 'http://10.0.0.5/webhook',
    })
    expect(result?.ok).toBe(false)
  })

  it('validateConfig accepts a public-looking url', async () => {
    const result = await webhookConnector.validateConfig?.({
      url: 'https://example.com/webhook',
    })
    expect(result?.ok).toBe(true)
  })

  it('deliver refuses a loopback destination without making a request', async () => {
    const out = await webhookConnector.deliver({
      payload: { a: 1 },
      config: { url: 'http://127.0.0.1:9999/webhook' },
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: false })
  })

  it('deliver refuses the cloud metadata destination', async () => {
    const out = await webhookConnector.deliver({
      payload: {},
      config: { url: 'http://169.254.169.254/latest/meta-data/iam/' },
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: false })
  })
})
