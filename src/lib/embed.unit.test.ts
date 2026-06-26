import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import { generateEmbedHtml } from '~/lib/embed'
import { formDefinitionSchema, type FormDefinition } from '~/lib/validation'

function define(raw: unknown): FormDefinition {
  const parsed = formDefinitionSchema(raw)
  if (parsed instanceof type.errors) throw new Error(parsed.summary)
  return parsed
}

const definition = define({
  version: 1,
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea' },
    { name: 'plan', label: 'Plan', type: 'select', options: ['free', 'pro'] },
    { name: 'subscribe', label: 'Subscribe', type: 'checkbox' },
  ],
})

const endpoint = 'https://autoform.example/f/f_abc123'

describe('generateEmbedHtml (FR-EMB-1)', () => {
  const html = generateEmbedHtml(endpoint, definition, {
    honeypotField: '_gotcha',
  })

  it('opens a POST form pointed at the endpoint', () => {
    expect(html).toContain(`<form action="${endpoint}" method="POST">`)
    expect(html.trimEnd().endsWith('</form>')).toBe(true)
  })

  it('renders an input per field with the right type and required flag', () => {
    expect(html).toContain('<input type="email" name="email" required>')
    expect(html).toContain('<textarea name="message"></textarea>')
    expect(html).toContain('<select name="plan">')
    expect(html).toContain('<option value="free">free</option>')
    expect(html).toContain('<input type="checkbox" name="subscribe">')
    expect(html).toContain('<button type="submit">Send</button>')
  })

  it('includes the honeypot field', () => {
    expect(html).toContain('name="_gotcha"')
    expect(html).toContain('left:-9999px')
  })

  it('includes a hidden _redirect only when a redirect URL is set', () => {
    expect(html).not.toContain('name="_redirect"')
    const withRedirect = generateEmbedHtml(endpoint, definition, {
      honeypotField: '_gotcha',
      redirectUrl: '/thanks',
    })
    expect(withRedirect).toContain(
      '<input type="hidden" name="_redirect" value="/thanks">',
    )
  })

  it('escapes attribute and text values', () => {
    const tricky = define({
      version: 1,
      fields: [{ name: 'q', label: 'A & B <x>', type: 'text' }],
    })
    const out = generateEmbedHtml('https://e.test/f/"x', tricky, {
      honeypotField: '_gotcha',
    })
    expect(out).toContain('action="https://e.test/f/&quot;x"')
    expect(out).toContain('A &amp; B &lt;x&gt;')
    expect(out).not.toContain('<x>')
  })
})
