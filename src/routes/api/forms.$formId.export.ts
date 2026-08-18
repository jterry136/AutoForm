import { createFileRoute } from '@tanstack/react-router'
import { buildExportResponse } from '~/lib/export-download'
import { getUserForRequest } from '~/lib/server-session'

/**
 * Authenticated submission download: GET /api/forms/{formId}/export?format=csv|json
 * (FR-SUB-4).
 *
 * A plain server route rather than a server function, because the browser needs
 * a URL it can navigate to for a file download. Session cookie in, file out —
 * all authorization lives in `buildExportResponse` (ownership, D-008).
 */
export const Route = createFileRoute('/api/forms/$formId/export')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url)
        // Path is /api/forms/{formId}/export; the id is the second-to-last part.
        const segments = url.pathname.split('/').filter(Boolean)
        const formId = decodeURIComponent(segments.at(-2) ?? '')

        const user = await getUserForRequest(request)
        return buildExportResponse(
          user?.id ?? null,
          formId,
          url.searchParams.get('format'),
        )
      },
    },
  },
})
