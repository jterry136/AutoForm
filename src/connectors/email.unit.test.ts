import { describe, expect, it } from 'vitest'
import {
  emailConnector,
  renderSubmission,
  sanitizeHeaderValue,
} from '~/connectors/email'

const CR = String.fromCharCode(13)
const LF = String.fromCharCode(10)
const TAB = String.fromCharCode(9)

function hasControlChars(value: string): boolean {
  return [...value].some((c) => {
    const code = c.charCodeAt(0)
    return code < 0x20 || code === 0x7f
  })
}

describe('email header sanitization (NFR-SEC-3)', () => {
  it('strips CR/LF so headers cannot be injected', () => {
    const cleaned = sanitizeHeaderValue(`Hello${CR}${LF}Bcc: evil@example.com`)
    expect(hasControlChars(cleaned)).toBe(false)
    expect(cleaned).toBe('Hello Bcc: evil@example.com')
  })

  it('collapses other control whitespace (tabs) too', () => {
    expect(sanitizeHeaderValue(`a${TAB}b`)).toBe('a b')
  })
})

describe('renderSubmission body (NFR-SEC-3)', () => {
  it('HTML-escapes submitted values in the HTML part', () => {
    const { html, text } = renderSubmission({
      note: '<b>hi</b>',
      tags: ['x', 'y'],
    })
    expect(html).toContain('&lt;b&gt;hi&lt;/b&gt;')
    expect(html).not.toContain('<b>hi</b>')
    // The plain-text part is not an injection vector, so it stays as-is.
    expect(text).toContain('note: <b>hi</b>')
    expect(text).toContain('tags: x, y')
  })
})

describe('emailConnector failure paths', () => {
  it('fails non-retryably when misconfigured (no key or no recipient)', async () => {
    const out = await emailConnector.deliver({
      payload: { a: 1 },
      config: {},
      credentials: null,
    })
    expect(out).toMatchObject({ ok: false, retryable: false })
  })

  it('validateConfig rejects a missing recipient', () => {
    expect(emailConnector.validateConfig?.({}).ok).toBe(false)
  })
})
