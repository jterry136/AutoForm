import type { ExportFormat } from '~/lib/export-download'

/**
 * The client-safe half of submission export (FR-SUB-4): the URL the dashboard
 * points at, and the formats it offers.
 *
 * Kept out of `lib/export-download.ts` on purpose — that module reaches the
 * database (and therefore secrets), so nothing in a client component may import
 * it at runtime. Only the `ExportFormat` type crosses, and types are erased.
 *
 * Export is a plain authenticated GET rather than a server function because a
 * download needs a URL the browser can navigate to; the dashboard link and the
 * documented endpoint are then the same thing.
 */

export interface ExportFormatOption {
  readonly format: ExportFormat
  /** Menu-item text; also the accessible name of the item. */
  readonly label: string
}

/** Offered in the inbox export menu, in this order. */
export const EXPORT_FORMAT_OPTIONS: readonly ExportFormatOption[] = [
  { format: 'csv', label: 'Export CSV' },
  { format: 'json', label: 'Export JSON' },
]

/**
 * Download URL for a form's submissions. `formId` is the dashboard id (never the
 * public embed id) and is encoded, so a value that is not a plain UUID can't
 * break out of the path — the endpoint rejects it as "not found" anyway.
 */
export function exportDownloadPath(
  formId: string,
  format: ExportFormat,
): string {
  return `/api/forms/${encodeURIComponent(formId)}/export?format=${format}`
}
