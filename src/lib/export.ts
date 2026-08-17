import type { DeliverySummary } from '~/lib/inbox'
import type { JsonObject, JsonValue } from '~/lib/json'
import type { FormDefinition } from '~/lib/validation'

/**
 * Submission export serializers (FR-SUB-4). Pure data-in / bytes-out: no DB
 * access and no routing, so every rule here is unit-testable in isolation. The
 * ownership-scoped query and the download route live elsewhere.
 *
 * Shape decisions, all deliberate:
 *
 * - **Columns derive from the definition (P-1).** Every field in the form
 *   definition gets a column, in definition order, even when no submission in
 *   the batch filled it — the file's shape is a property of the form, not of
 *   whichever rows happen to be exported. Keys that appear in a payload but not
 *   in the definition (BYO or legacy submissions) are appended after them,
 *   sorted lexicographically so the header is deterministic.
 * - **Fixed metadata columns lead**: `submission_id`, `submitted_at` (ISO-8601
 *   UTC), `delivery_status` — the rolled-up per-submission delivery state.
 * - **Non-scalar payload values are JSON-stringified** in CSV (a multiselect
 *   renders as `["a","b"]`). JSON export keeps them structured.
 * - **CSV formula injection is neutralized**, not just escaped: a value opening
 *   with `=`, `+`, `-`, `@`, TAB or CR is prefixed with `'` so a spreadsheet
 *   treats submitted content as text. This is a security rule (a submission is
 *   attacker-controlled), not cosmetic.
 *
 * Nothing secret is exportable from here (P-2): the input carries only
 * submission payloads and submission-level metadata — never destination config
 * or credentials.
 */

/** A submission as the exporter needs it — a subset of `SubmissionWithDelivery`. */
export interface ExportableSubmission {
  id: string
  createdAt: Date
  normalizedPayload: JsonObject
  deliveryStatus: DeliverySummary
}

/** Leading, fixed columns, before the payload columns. */
export const EXPORT_METADATA_COLUMNS = [
  'submission_id',
  'submitted_at',
  'delivery_status',
] as const

const CRLF = '\r\n'

/** Leading characters a spreadsheet may treat as the start of a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

/**
 * Payload column names for a batch: definition fields in definition order,
 * then any extra submitted keys sorted lexicographically.
 */
export function deriveExportColumns(
  definition: FormDefinition,
  submissions: readonly ExportableSubmission[],
): string[] {
  const defined = definition.fields.map((f) => f.name)
  const known = new Set(defined)

  const extra = new Set<string>()
  for (const s of submissions) {
    for (const key of Object.keys(s.normalizedPayload)) {
      if (!known.has(key)) extra.add(key)
    }
  }

  return [...defined, ...[...extra].sort()]
}

/** Render one payload value as a CSV cell string. */
function renderCell(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

/** Prefix values a spreadsheet might evaluate so they stay inert text. */
function neutralizeFormula(value: string): string {
  const first = value.charAt(0)
  return first !== '' && FORMULA_TRIGGERS.has(first) ? `'${value}` : value
}

/** RFC 4180 quoting: doubled quotes, quoted when the value needs it. */
function quote(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim()
  if (!needsQuotes) return value
  return `"${value.replace(/"/g, '""')}"`
}

function csvField(value: string): string {
  return quote(neutralizeFormula(value))
}

/**
 * CSV (RFC 4180): CRLF line endings, UTF-8, a trailing newline after the last
 * row. Always emits the header row, even for an empty submission set.
 */
export function serializeSubmissionsToCsv(
  definition: FormDefinition,
  submissions: readonly ExportableSubmission[],
): string {
  const columns = deriveExportColumns(definition, submissions)
  const header = [...EXPORT_METADATA_COLUMNS, ...columns].map(csvField)

  const rows = submissions.map((s) => {
    const meta = [
      s.id,
      s.createdAt.toISOString(),
      s.deliveryStatus,
    ] satisfies string[]
    const payload = columns.map((c) => renderCell(s.normalizedPayload[c]))
    return [...meta, ...payload].map(csvField).join(',')
  })

  return [header.join(','), ...rows].join(CRLF) + CRLF
}

/** One exported submission in JSON form; key order is stable. */
export interface ExportedSubmissionJson {
  id: string
  submittedAt: string
  deliveryStatus: DeliverySummary
  payload: JsonObject
}

/** Build the JSON-export objects (also useful for tests and other callers). */
export function toExportJson(
  definition: FormDefinition,
  submissions: readonly ExportableSubmission[],
): ExportedSubmissionJson[] {
  const columns = deriveExportColumns(definition, submissions)

  return submissions.map((s) => {
    // Rebuild the payload in column order so key order is stable across rows.
    const payload: JsonObject = {}
    for (const column of columns) {
      const value = s.normalizedPayload[column]
      if (value !== undefined) payload[column] = value
    }
    return {
      id: s.id,
      submittedAt: s.createdAt.toISOString(),
      deliveryStatus: s.deliveryStatus,
      payload,
    }
  })
}

/** JSON: a pretty-printed array of submissions, with a trailing newline. */
export function serializeSubmissionsToJson(
  definition: FormDefinition,
  submissions: readonly ExportableSubmission[],
): string {
  return JSON.stringify(toExportJson(definition, submissions), null, 2) + '\n'
}
