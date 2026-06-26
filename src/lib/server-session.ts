import { getRequest } from '@tanstack/react-start/server'
import { auth } from '~/lib/auth'

/**
 * Server-only session helpers for server functions. Resolve the Better Auth
 * session from the incoming request. Never import into client code.
 */

export async function getCurrentUser() {
  const { headers } = getRequest()
  const session = await auth.api.getSession({ headers })
  return session?.user ?? null
}

/** Returns the current user's id, or throws if unauthenticated (defense in depth). */
export async function requireUserId(): Promise<string> {
  const user = await getCurrentUser()
  if (!user) throw new Error('Unauthorized')
  return user.id
}
