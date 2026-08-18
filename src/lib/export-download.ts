import {
  serializeSubmissionsToCsv,
  serializeSubmissionsToJson,
} from '~/lib/export'
import { EXPORT_ROW_LIMIT, loadFormExport } from '~/lib/inbox'

/**
 * The download half of submission export (FR-SUB-4): turn "this user wants this
 * form in this format" into an HTTP response. The serializers (`lib/export.ts`)
 * stay pure and the route file (`routes/api/forms.$formId.export.ts`) stays a
 * three-line adapter, so the rules that matter — authorization, format
 * negotiation, filename, the row cap — are testable without a running server.
 *
 * Authorization is ownership (D-008), resolved by the caller and passed in as
 * `userId`. A form that is not the caller's is reported exactly like a form that
 * does not exist: 404, same body. A missing session is 401. Never trust the
 * `formId` from the URL for anything but a lookup key.
 */

export type ExportFormat = 'csv' | 'json'

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  json: 'application/json; charset=utf-8',
}

/** Postgres would reject a non-UUID `formId`, so reject it before querying. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `?format=` → a supported format. Absent means CSV (the common case). */
export function parseExportFormat(raw: string | null): ExportFormat | null {
  const value = (raw ?? 'csv').trim().toLowerCase()
  return value === 'csv' || value === 'json' ? value : null
}

/**
 * A safe, predictable attachment filename: `<form-name>-submissions-<date>.<ext>`.
 * The form name is attacker-influenced only by the form's own owner, but it still
 * gets reduced to `[a-z0-9-]` so nothing can smuggle a quote, a path separator,
 * or a newline into the `Content-Disposition` header.
 */
export function exportFilename(
  formName: string,
  format: ExportFormat,
  now: Date,
): string {
  const slug =
    formName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/g, '') || 'form'
  const date = now.toISOString().slice(0, 10)
  return `${slug}-submissions-${date}.${format}`
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

export interface ExportResponseOptions {
  /** Stamp used in the filename; injectable so tests are not clock-dependent. */
  now?: Date
  /** Row cap; injectable so the truncation path is testable without 10k rows. */
  limit?: number
}

/**
 * Build the export download for `formId`, or the matching error response.
 *
 * @param userId the authenticated user's id, or null when there is no session
 * @param formId the form id from the request path (untrusted)
 * @param rawFormat the raw `format` query parameter
 */
export async function buildExportResponse(
  userId: string | null,
  formId: string,
  rawFormat: string | null,
  { now = new Date(), limit = EXPORT_ROW_LIMIT }: ExportResponseOptions = {},
): Promise<Response> {
  if (!userId) return errorResponse(401, 'Sign in to export submissions.')

  const format = parseExportFormat(rawFormat)
  if (!format) {
    return errorResponse(400, 'Unsupported export format. Use csv or json.')
  }

  // Same response as "not yours" — a malformed id must not read differently
  // from a well-formed one that belongs to someone else.
  if (!UUID_RE.test(formId)) return errorResponse(404, 'Form not found.')

  const data = await loadFormExport(userId, formId, limit)
  if (!data) return errorResponse(404, 'Form not found.')

  const body =
    format === 'csv'
      ? serializeSubmissionsToCsv(data.definition, data.submissions)
      : serializeSubmissionsToJson(data.definition, data.submissions)

  const headers: Record<string, string> = {
    'content-type': CONTENT_TYPES[format],
    'content-disposition': `attachment; filename="${exportFilename(
      data.formName,
      format,
      now,
    )}"`,
    // Submission content is private and must not be cached by proxies.
    'cache-control': 'no-store',
    'x-export-row-count': String(data.submissions.length),
  }
  if (data.truncated) {
    // Surfaced as a header (not an in-file row) so the file stays valid CSV/JSON.
    headers['x-export-truncated'] = 'true'
    headers['x-export-row-limit'] = String(data.limit)
  }

  return new Response(body, { status: 200, headers })
}
