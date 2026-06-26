import { randomBytes } from 'node:crypto'

/**
 * Generate a high-entropy, URL-safe public form ID (FR-ACC-3, NFR-SEC-5).
 * 18 bytes ≈ 144 bits of entropy, base64url-encoded; the `f_` prefix makes IDs
 * recognizable in logs and embed code.
 */
export function generatePublicId(): string {
  return `f_${randomBytes(18).toString('base64url')}`
}
