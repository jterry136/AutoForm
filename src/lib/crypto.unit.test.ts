import { describe, expect, it } from 'vitest'
import { decrypt, encrypt } from '~/lib/crypto'

describe('crypto — AES-256-GCM credential encryption (P-2/D-004)', () => {
  it('round-trips a value through encrypt/decrypt', () => {
    const secret = 'xoxb-super-secret-token'
    expect(decrypt(encrypt(secret))).toBe(secret)
  })

  it('produces a version-tagged blob and distinct ciphertext per call (random IV)', () => {
    const a = encrypt('same input')
    const b = encrypt('same input')
    expect(a.startsWith('v1:')).toBe(true)
    expect(b.startsWith('v1:')).toBe(true)
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe('same input')
    expect(decrypt(b)).toBe('same input')
  })

  it('detects tampering via the GCM auth tag', () => {
    const blob = encrypt('do-not-tamper')
    // Flip a character in the base64 payload (after the "v1:" prefix).
    const idx = blob.length - 4
    const swapped = blob[idx] === 'A' ? 'B' : 'A'
    const tampered = blob.slice(0, idx) + swapped + blob.slice(idx + 1)
    expect(() => decrypt(tampered)).toThrow()
  })

  it('rejects a malformed value with no version prefix', () => {
    expect(() => decrypt('not-a-valid-blob')).toThrow()
  })
})
