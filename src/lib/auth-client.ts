import { createAuthClient } from 'better-auth/react'

/**
 * Browser-side Better Auth client. Safe to import into client components — it
 * talks to /api/auth over HTTP and holds no secrets. baseURL defaults to the
 * current origin, and the basePath defaults to /api/auth (matching the route).
 */
export const authClient = createAuthClient()

export const { signIn, signUp, signOut, useSession } = authClient
