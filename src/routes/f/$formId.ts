import { createFileRoute } from '@tanstack/react-router'
import { ingestSubmission, type IngestResult } from '~/lib/ingest'
import type { SubmissionError } from '~/lib/validation'

/**
 * Public ingestion endpoint: POST /f/{publicId} (FR-ING-1). Accepts urlencoded
 * (no-JS form post) and JSON (AJAX). Responds fast — 303 redirect for the no-JS
 * path, JSON for the AJAX path (content negotiation is AutoForm's call).
 *
 * CORS is open here by design: the endpoint is public, carries no credentials or
 * cookies, and security comes from the unguessable ID + (Chunk 7) honeypot/rate
 * limiting. Phase 1 scopes CORS to the form's allowed origins (FR-SPAM-3).
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function htmlResponse(
  status: number,
  title: string,
  bodyHtml: string,
): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(
    title,
  )}</title><style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}h1{font-size:1.25rem}ul{padding-left:1.25rem}a{color:inherit}</style></head><body><h1>${escapeHtml(
    title,
  )}</h1>${bodyHtml}<p><a href="javascript:history.back()">← Go back</a></p></body></html>`
  return new Response(html, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

function errorListHtml(errors: SubmissionError[]): string {
  const items = errors.map((e) => `<li>${escapeHtml(e.message)}</li>`).join('')
  return `<p>Your submission couldn't be accepted:</p><ul>${items}</ul>`
}

function respond(result: IngestResult, wantsJson: boolean): Response {
  switch (result.status) {
    case 'ok':
      if (wantsJson) {
        return jsonResponse({ ok: true, id: result.submissionId }, 200)
      }
      return new Response(null, {
        status: 303,
        headers: {
          Location: result.redirectTarget ?? '/success',
          ...CORS_HEADERS,
        },
      })
    case 'invalid':
      return wantsJson
        ? jsonResponse({ ok: false, errors: result.errors }, 422)
        : htmlResponse(422, 'Submission error', errorListHtml(result.errors))
    case 'not_found':
      return wantsJson
        ? jsonResponse({ ok: false, error: 'Form not found' }, 404)
        : htmlResponse(
            404,
            'Form not found',
            '<p>This form does not exist.</p>',
          )
    case 'unsupported_media':
      return wantsJson
        ? jsonResponse({ ok: false, error: 'Unsupported content type' }, 415)
        : htmlResponse(
            415,
            'Unsupported content type',
            '<p>Send the form as urlencoded or JSON.</p>',
          )
    case 'misconfigured':
      return wantsJson
        ? jsonResponse({ ok: false, error: 'Form is misconfigured' }, 500)
        : htmlResponse(
            500,
            'Form is misconfigured',
            '<p>Please contact the form owner.</p>',
          )
  }
}

export const Route = createFileRoute('/f/$formId')({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),
      POST: async ({ request }) => {
        const publicId = decodeURIComponent(
          new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '',
        )
        const accept = request.headers.get('accept') ?? ''
        const contentType = request.headers.get('content-type') ?? ''
        const wantsJson =
          accept.includes('application/json') ||
          contentType.includes('application/json')

        const result = await ingestSubmission(request, publicId)
        return respond(result, wantsJson)
      },
    },
  },
})
