import { createFileRoute } from '@tanstack/react-router'
import { auth } from '~/lib/auth'

/**
 * Mounts Better Auth at /api/auth/* (its default basePath). The splat route
 * forwards every GET/POST to the Better Auth request handler, which owns
 * sign-up, sign-in, sign-out, session, etc. Server-only handlers — `auth` is
 * never bundled to the client.
 */
export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
})
