import { type } from 'arktype'

/**
 * Server-side environment variables, validated on first import (fail fast).
 *
 * Only import this from server code (DB client, auth, connectors). Importing it
 * into a client bundle would be a P-2 / NFR-SEC-2 violation — secrets must never
 * reach the client.
 *
 * Validation happens when this module is first imported, not at process boot, so
 * a page that touches no server feature can still render without a populated
 * `.env`. Anything that reaches the database, auth, or a connector fails loudly
 * with the offending variable named.
 *
 * This schema is the contract. `docs/configuration.md` is the prose reference and
 * `.env.example` the template; `ENV_VARS` below ties the three together and
 * `env.unit.test.ts` asserts they agree (D-014).
 */
export const envSchema = type({
  // Supabase Postgres connection string.
  DATABASE_URL: 'string >= 1',
  // Better Auth.
  BETTER_AUTH_SECRET: 'string >= 1',
  BETTER_AUTH_URL: 'string >= 1',
  // Destination credential encryption (AES-256-GCM). 32 bytes, base64-encoded.
  ENCRYPTION_KEY: 'string >= 1',
  // Resend — required only by the email connector.
  'RESEND_API_KEY?': 'string >= 1',
  // Delivery-health detection (D-010). Both optional; sensible defaults live in
  // src/lib/delivery-health.ts. Consecutive dead-letters before a destination is
  // flagged unhealthy, and the suppression window between notifications.
  'DELIVERY_HEALTH_THRESHOLD?': 'string.integer.parse',
  'DELIVERY_HEALTH_COOLOFF_MINUTES?': 'string.integer.parse',
  // How often the retention purge pass runs, in milliseconds. Optional; defaults
  // to hourly and is clamped to a one-minute floor in src/lib/retention-purge.ts.
  'RETENTION_PURGE_INTERVAL_MS?': '/^[0-9]+$/',
  // From address for AutoForm's own platform mail (src/lib/mailer.ts). Optional
  // — falls back to the Resend onboarding sender, which only works for testing.
  'MAIL_FROM?': 'string >= 1',
})

/** Documentation metadata for one environment variable. */
export interface EnvVarDoc {
  readonly name: string
  /** Required means absence is startup-fatal for any server code path. */
  readonly required: boolean
  /** What breaks when it is absent. */
  readonly summary: string
  /**
   * A value the schema accepts. Not every variable is a free-form string — the
   * delivery-health and purge tunables parse as numbers — so the parity test
   * needs a per-variable sample rather than one fabricated string for all of
   * them. Never a real secret.
   */
  readonly sample: string
}

/**
 * Every variable the app reads, and what its absence costs. Keep in step with the
 * schema above, `.env.example`, and the table in `docs/configuration.md` — the
 * unit test fails if they diverge.
 */
export const ENV_VARS: readonly EnvVarDoc[] = [
  {
    name: 'DATABASE_URL',
    required: true,
    summary:
      'Postgres connection string. Absent: all storage fails and the delivery worker never starts.',
    sample: 'postgres://user:pass@localhost:5432/autoform',
  },
  {
    name: 'BETTER_AUTH_SECRET',
    required: true,
    summary: 'Better Auth signing secret. Absent: authentication is unusable.',
    sample: 'test-better-auth-secret',
  },
  {
    name: 'BETTER_AUTH_URL',
    required: true,
    summary:
      'Public base URL of this instance. Absent: auth cannot build callback/cookie URLs.',
    sample: 'http://localhost:3000',
  },
  {
    name: 'ENCRYPTION_KEY',
    required: true,
    summary:
      'Base64 32-byte AES-256-GCM key for destination credentials (D-004). Absent: no credential can be stored or decrypted.',
    sample: 'aGVsbG8td29ybGQtdGhpcy1pcy0zMi1ieXRlcyEh',
  },
  {
    name: 'RESEND_API_KEY',
    required: false,
    summary:
      'Resend API key. Absent: email destinations are rejected at config time and email deliveries dead-letter; everything else works.',
    sample: 're_test_key',
  },
  {
    name: 'MAIL_FROM',
    required: false,
    summary:
      "Sender identity for AutoForm's own platform mail. Absent: falls back to Resend's onboarding sender, which is only suitable for testing.",
    sample: 'AutoForm <notifications@example.com>',
  },
  {
    name: 'DELIVERY_HEALTH_THRESHOLD',
    required: false,
    summary:
      'Consecutive dead-lettered deliveries before a destination is flagged unhealthy (D-010). Absent: defaults to 3.',
    sample: '3',
  },
  {
    name: 'DELIVERY_HEALTH_COOLOFF_MINUTES',
    required: false,
    summary:
      'Minimum gap between two alerts about the same destination (D-010). Absent: defaults to 1440 (24h).',
    sample: '1440',
  },
  {
    name: 'RETENTION_PURGE_INTERVAL_MS',
    required: false,
    summary:
      'How often the age-based retention purge pass runs (D-011). Absent: defaults to hourly; values below 60000 are clamped to one minute.',
    sample: '3600000',
  },
]

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
      'See .env.example and docs/configuration.md, and copy .env.example to .env.',
  )
}

export const env = parsed
