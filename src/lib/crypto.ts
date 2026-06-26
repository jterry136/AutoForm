import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { env } from '~/lib/env'

/**
 * Destination credential encryption (P-2 / NFR-SEC-1; DECISIONS.md D-004).
 *
 * AES-256-GCM (authenticated encryption — tampering is detected on decrypt).
 * Stored blob format:
 *
 *   <version>:<base64( iv[12] ‖ authTag[16] ‖ ciphertext )>
 *
 * The version prefix makes key rotation unambiguous: each row records which key
 * encrypted it, so old rows keep decrypting after the current key changes.
 *
 * Server-only — never import into client code. Plaintext credentials must never
 * leave the server; decrypt only at the moment of a delivery call.
 */

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // GCM standard 96-bit nonce
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32 // AES-256

/** The version new values are encrypted under. Bump when rotating keys. */
const CURRENT_VERSION = 'v1'

function loadKey(raw: string, version: string): Buffer {
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `Encryption key "${version}" must be ${KEY_LENGTH} bytes (base64-encoded); ` +
        `got ${key.length}. Generate one with:\n` +
        `  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    )
  }
  return key
}

/**
 * Version → key registry. To rotate: add the new version's key here from its own
 * env var, point CURRENT_VERSION at it, and keep prior versions so existing
 * ciphertext still decrypts.
 */
const keys: Record<string, Buffer> = {
  v1: loadKey(env.ENCRYPTION_KEY, 'v1'),
}

/** Encrypt a UTF-8 string, returning a version-tagged, base64 blob. */
export function encrypt(plaintext: string): string {
  const key = keys[CURRENT_VERSION]
  if (!key) throw new Error(`Missing encryption key for ${CURRENT_VERSION}`)

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()
  const blob = Buffer.concat([iv, authTag, ciphertext]).toString('base64')
  return `${CURRENT_VERSION}:${blob}`
}

/** Decrypt a value produced by {@link encrypt}, selecting the key by version. */
export function decrypt(stored: string): string {
  const sepIndex = stored.indexOf(':')
  if (sepIndex === -1) {
    throw new Error('Malformed encrypted value: missing version prefix')
  }

  const version = stored.slice(0, sepIndex)
  const key = keys[version]
  if (!key) throw new Error(`Unknown encryption key version: "${version}"`)

  const data = Buffer.from(stored.slice(sepIndex + 1), 'base64')
  const iv = data.subarray(0, IV_LENGTH)
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH)
  const ciphertext = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH)

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf8')
}
