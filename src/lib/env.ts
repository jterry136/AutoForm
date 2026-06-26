import { type } from 'arktype'

/**
 * Server-side environment variables, validated at first import (fail fast).
 *
 * Only import this from server code (DB client, auth, connectors). Importing it
 * into a client bundle would be a P-2 / NFR-SEC-2 violation — secrets must never
 * reach the client.
 *
 * During early scaffolding (Chunk 0) the DB/auth/email integrations are not yet
 * wired, so nothing on the default page imports this module; the dev server boots
 * without a populated `.env`. As server features land, this enforces presence.
 */
const envSchema = type({
  // Supabase Postgres connection string.
  DATABASE_URL: 'string >= 1',
  // Better Auth.
  BETTER_AUTH_SECRET: 'string >= 1',
  BETTER_AUTH_URL: 'string >= 1',
  // Destination credential encryption (AES-256-GCM). 32 bytes, base64-encoded.
  ENCRYPTION_KEY: 'string >= 1',
  // Resend (used from the email connector chunk onward).
  'RESEND_API_KEY?': 'string >= 1',
})

// Treat empty-string env vars (e.g. `RESEND_API_KEY=` in .env) as unset, so an
// optional var left blank is "absent" rather than an invalid empty value, while
// a blank required var still fails clearly.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== undefined && v !== ''),
)

const parsed = envSchema(rawEnv)

if (parsed instanceof type.errors) {
  throw new Error(
    `Invalid or missing environment variables:\n${parsed.summary}\n` +
      'See .env.example and copy it to .env.',
  )
}

export const env = parsed
