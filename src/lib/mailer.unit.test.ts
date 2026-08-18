import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type DeliveryHealthAlert,
  type MailResult,
  type SystemEmail,
  formDashboardUrl,
  notifyDeliveryFailure,
  renderDeliveryFailureEmail,
  sendSystemEmail,
} from '~/lib/mailer'

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)

function hasControlChars(value: string): boolean {
  return [...value].some((c) => {
    const code = c.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

/** A fake provider: records what it was asked to send, never touches network. */
function fakeSender(result: MailResult = { ok: true, id: 'fake-1' }) {
  const sent: SystemEmail[] = []
  const send = vi.fn(async (message: SystemEmail) => {
    sent.push(message)
    return result
  })
  return { send, sent }
}

const alert: DeliveryHealthAlert = {
  formId: '11111111-1111-4111-8111-111111111111',
  formName: 'Contact form',
  destinationId: '22222222-2222-4222-8222-222222222222',
  destinationName: 'Ops webhook',
  destinationType: 'webhook',
  failureCount: 3,
  lastError: 'HTTP 500 from https://example.com/hook',
  lastFailedAt: new Date('2026-08-17T09:30:00.000Z'),
}

const owner = { email: 'owner@example.com', name: 'Owner' }
const resolveOwner = async () => owner

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('notifyDeliveryFailure recipient (FR-NOTIF-1)', () => {
  it('sends exactly one email to the owning account address', async () => {
    const { send, sent } = fakeSender()

    const result = await notifyDeliveryFailure(alert, { send, resolveOwner })

    expect(result).toEqual({ ok: true, id: 'fake-1' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(sent[0]?.to).toBe('owner@example.com')
  })

  it('includes a working dashboard deep link for the form', async () => {
    const { send, sent } = fakeSender()
    await notifyDeliveryFailure(alert, { send, resolveOwner })

    const expected = formDashboardUrl(alert.formId, 'http://localhost:3000')
    expect(expected).toBe(
      `http://localhost:3000/dashboard/forms/${alert.formId}`,
    )
    expect(sent[0]?.text).toContain(expected)
    expect(sent[0]?.html).toContain(expected)
  })

  it('skips (without sending) when the form has no resolvable owner', async () => {
    const { send } = fakeSender()

    const result = await notifyDeliveryFailure(alert, {
      send,
      resolveOwner: async () => null,
    })

    expect(result).toMatchObject({ ok: false, skipped: true })
    expect(send).not.toHaveBeenCalled()
  })

  it('never throws when the owner lookup or the provider fails', async () => {
    const boom = async () => {
      throw new Error('db is down')
    }

    await expect(
      notifyDeliveryFailure(alert, {
        send: fakeSender().send,
        resolveOwner: boom,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'db is down' })

    await expect(
      notifyDeliveryFailure(alert, {
        resolveOwner,
        send: async () => {
          throw new Error('provider exploded')
        },
      }),
    ).resolves.toMatchObject({ ok: false, error: 'provider exploded' })
  })
})

describe('notification content safety (NFR-SEC-3)', () => {
  it('cannot be used to inject an email header via form or destination name', () => {
    const { subject } = renderDeliveryFailureEmail(
      {
        ...alert,
        destinationName: `Ops${CR}${LF}Bcc: evil@example.com`,
        formName: `Contact${CR}${LF}X-Injected: yes`,
      },
      'http://localhost:3000/dashboard/forms/x',
    )

    expect(hasControlChars(subject)).toBe(false)
    expect(subject).not.toMatch(/^Bcc:/m)
  })

  it('escapes destination-supplied error text in the HTML part', () => {
    const { html, text } = renderDeliveryFailureEmail(
      { ...alert, lastError: '<img src=x onerror="alert(1)">' },
      'http://localhost:3000/dashboard/forms/x',
    )

    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
    expect(html).not.toContain('<img src=x')
    // The plain-text part is not a markup-injection vector.
    expect(text).toContain('Last error:')
  })

  it('truncates a very long error rather than mailing it whole', () => {
    const { text } = renderDeliveryFailureEmail(
      { ...alert, lastError: 'x'.repeat(5_000) },
      'http://localhost:3000/dashboard/forms/x',
    )

    expect(text).toContain('…')
    expect(text.length).toBeLessThan(2_000)
  })

  it('mails no submission content, even if a payload is smuggled onto the alert', async () => {
    const { send, sent } = fakeSender()
    const smuggled = {
      ...alert,
      // The type has no payload field; prove nothing renders it if one appears.
      payload: { email: 'submitter@example.com', message: 'secret-body-text' },
      rawBody: 'email=submitter%40example.com&message=secret-body-text',
    } as DeliveryHealthAlert

    await notifyDeliveryFailure(smuggled, { send, resolveOwner })

    const message = sent[0]
    expect(message).toBeDefined()
    for (const part of [message!.subject, message!.text, message!.html]) {
      expect(part).not.toContain('secret-body-text')
      expect(part).not.toContain('submitter@example.com')
    }
  })

  it('omits the error row entirely when there is no error text', () => {
    const { text, html } = renderDeliveryFailureEmail(
      { ...alert, lastError: null },
      'http://localhost:3000/dashboard/forms/x',
    )

    expect(text).not.toContain('Last error:')
    expect(html).not.toContain('Last error')
  })
})

describe('graceful degradation without RESEND_API_KEY', () => {
  it('sendSystemEmail is a clean, logged no-op rather than a throw', async () => {
    // The test env deliberately leaves RESEND_API_KEY unset.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const result = await sendSystemEmail({
      to: 'owner@example.com',
      subject: 'hi',
      text: 'hi',
      html: '<p>hi</p>',
    })

    expect(result).toMatchObject({ ok: false, skipped: true })
    expect(warn).toHaveBeenCalled()
  })

  it('notifyDeliveryFailure reports the skip without failing the caller', async () => {
    const result = await notifyDeliveryFailure(alert, { resolveOwner })

    expect(result).toMatchObject({ ok: false, skipped: true })
  })
})

describe('formDashboardUrl', () => {
  it('tolerates a base URL with a trailing slash and encodes the id', () => {
    expect(formDashboardUrl('a/b', 'http://x.test/')).toBe(
      'http://x.test/dashboard/forms/a%2Fb',
    )
  })
})
