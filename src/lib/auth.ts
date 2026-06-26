import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { db } from '~/db'
import * as authSchema from '~/db/auth-schema'
import { env } from '~/lib/env'

/**
 * Better Auth server instance. Server-only — it pulls in `db` and `env` (secrets)
 * and must never be imported into a client bundle.
 *
 * MVP: email + password, no email verification yet (the Resend connector lands in
 * a later chunk). Other methods (OAuth, magic link) can be added later without
 * changing this contract.
 *
 * `tanstackStartCookies()` lets Better Auth set/read auth cookies through
 * TanStack Start's request context. Keep it last in the plugins array.
 */
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
  },
  plugins: [tanstackStartCookies()],
})
