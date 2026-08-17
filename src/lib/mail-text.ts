/**
 * Low-level text primitives shared by everything that composes email
 * (NFR-SEC-3). Kept in `lib/` rather than in a connector so that AutoForm's own
 * platform mail (`src/lib/mailer.ts`) and the user-configured email connector
 * (`src/connectors/email.ts`) can share them without platform mail depending on
 * the connector registry.
 */

/**
 * Strip CR/LF and other control chars from a value used in an email header,
 * collapsing the resulting whitespace. Uses char codes (not a control-char regex
 * literal) to keep the source free of embedded control characters.
 *
 * Header injection works by smuggling a CRLF into a header value to start a new
 * header (`Bcc:`, `Content-Type:`); removing control chars removes the vector.
 */
export function sanitizeHeaderValue(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Escape a value for interpolation into an HTML email body. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
