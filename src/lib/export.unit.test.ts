import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import {
  EXPORT_METADATA_COLUMNS,
  deriveExportColumns,
  serializeSubmissionsToCsv,
  serializeSubmissionsToJson,
  toExportJson,
  type ExportableSubmission,
} from '~/lib/export'
import type { JsonObject } from '~/lib/json'
import { formDefinitionSchema, type FormDefinition } from '~/lib/validation'

function define(raw: unknown): FormDefinition {
  const parsed = formDefinitionSchema(raw)
  if (parsed instanceof type.errors) throw new Error(parsed.summary)
  return parsed
}

const definition = define({
  version: 1,
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea' },
    { name: 'plan', label: 'Plan', type: 'select', options: ['free', 'pro'] },
    { name: 'tags', label: 'Tags', type: 'multiselect', options: ['a', 'b'] },
    { name: 'subscribe', label: 'Subscribe', type: 'checkbox' },
  ],
})

let seq = 0
function submission(
  payload: JsonObject,
  overrides: Partial<ExportableSubmission> = {},
): ExportableSubmission {
  seq += 1
  return {
    id: `sub_${seq}`,
    createdAt: new Date('2026-07-01T12:34:56.000Z'),
    normalizedPayload: payload,
    deliveryStatus: 'delivered',
    ...overrides,
  }
}

/** Split a CSV string into its CRLF-separated rows (trailing newline dropped). */
function rows(csv: string): string[] {
  expect(csv.endsWith('\r\n')).toBe(true)
  return csv.slice(0, -2).split('\r\n')
}

describe('deriveExportColumns (FR-SUB-4)', () => {
  it('lists definition fields in definition order', () => {
    const columns = deriveExportColumns(definition, [
      submission({ plan: 'pro', email: 'a@example.test' }),
    ])
    expect(columns).toEqual(['email', 'message', 'plan', 'tags', 'subscribe'])
  })

  it('keeps definition fields that no submission filled', () => {
    const columns = deriveExportColumns(definition, [
      submission({ email: 'a@example.test' }),
    ])
    expect(columns).toContain('message')
  })

  it('appends extra keys after definition fields, sorted deterministically', () => {
    const columns = deriveExportColumns(definition, [
      submission({ email: 'a@example.test', zeta: '1', alpha: '2' }),
      submission({ email: 'b@example.test', middle: '3', alpha: '4' }),
    ])
    expect(columns.slice(-3)).toEqual(['alpha', 'middle', 'zeta'])
    expect(columns.indexOf('alpha')).toBeGreaterThan(
      columns.indexOf('subscribe'),
    )
  })

  it('returns just the definition columns for an empty submission set', () => {
    expect(deriveExportColumns(definition, [])).toEqual([
      'email',
      'message',
      'plan',
      'tags',
      'subscribe',
    ])
  })
})

describe('serializeSubmissionsToCsv (FR-SUB-4)', () => {
  it('leads with the fixed metadata columns, then payload columns', () => {
    const csv = serializeSubmissionsToCsv(definition, [])
    expect(rows(csv)).toEqual([
      'submission_id,submitted_at,delivery_status,email,message,plan,tags,subscribe',
    ])
    expect(EXPORT_METADATA_COLUMNS).toEqual([
      'submission_id',
      'submitted_at',
      'delivery_status',
    ])
  })

  it('writes metadata and payload values, blanking missing keys', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission(
        { email: 'a@example.test', subscribe: true },
        { id: 'sub_x', deliveryStatus: 'pending' },
      ),
    ])
    expect(rows(csv)[1]).toBe(
      'sub_x,2026-07-01T12:34:56.000Z,pending,a@example.test,,,,true',
    )
  })

  it('quotes and escapes per RFC 4180', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({
        email: 'a@example.test',
        message: 'He said "hi", then\r\nleft',
      }),
    ])
    // Quotes doubled; the comma and the embedded CRLF live inside the quotes.
    expect(csv).toContain('"He said ""hi"", then\r\nleft"')
  })

  it('quotes values containing a delimiter or surrounding whitespace', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ message: 'a,b', plan: ' padded ' }),
    ])
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('" padded "')
  })

  it('neutralizes spreadsheet formula injection', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ message: '=SUM(A1:A9)' }),
      submission({ message: '+1' }),
      submission({ message: '-1+1' }),
      submission({ message: '@import' }),
      submission({ message: '\tcmd' }),
    ])
    const body = rows(csv).slice(1)
    expect(body[0]).toContain(",'=SUM(A1:A9),")
    expect(body[1]).toContain(",'+1,")
    expect(body[2]).toContain(",'-1+1,")
    expect(body[3]).toContain(",'@import,")
    expect(body[4]).toContain(`,'\tcmd,`)
    expect(csv).not.toContain(',=SUM')
  })

  it('leaves ordinary values unprefixed', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ message: 'hello' }),
    ])
    expect(csv).toContain(',hello,')
    expect(csv).not.toContain("'hello")
  })

  it('JSON-stringifies non-scalar payload values', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ tags: ['a', 'b'], zeta: { nested: 1 } }),
    ])
    expect(csv).toContain('"[""a"",""b""]"')
    expect(csv).toContain('"{""nested"":1}"')
  })

  it('renders null as an empty cell', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ message: null }),
    ])
    expect(rows(csv)[1]).toContain(',,')
  })

  it('uses CRLF line endings and a trailing newline', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ email: 'a@example.test' }),
      submission({ email: 'b@example.test' }),
    ])
    expect(rows(csv)).toHaveLength(3)
    expect(csv).not.toMatch(/[^\r]\n/)
  })

  it('escapes header cells derived from arbitrary extra keys', () => {
    const csv = serializeSubmissionsToCsv(definition, [
      submission({ 'we,ird': 'x' }),
    ])
    expect(rows(csv)[0]).toContain('"we,ird"')
  })
})

describe('serializeSubmissionsToJson (FR-SUB-4)', () => {
  it('emits an array with a stable key order per submission', () => {
    const json = serializeSubmissionsToJson(definition, [
      submission(
        { email: 'a@example.test', tags: ['a'] },
        { id: 'sub_y', deliveryStatus: 'partial' },
      ),
    ])
    expect(json.endsWith('\n')).toBe(true)
    expect(JSON.parse(json)).toEqual([
      {
        id: 'sub_y',
        submittedAt: '2026-07-01T12:34:56.000Z',
        deliveryStatus: 'partial',
        payload: { email: 'a@example.test', tags: ['a'] },
      },
    ])
    expect(Object.keys(JSON.parse(json)[0])).toEqual([
      'id',
      'submittedAt',
      'deliveryStatus',
      'payload',
    ])
  })

  it('orders payload keys by definition order, extras last', () => {
    const exported = toExportJson(definition, [
      submission({ zeta: '1', plan: 'pro', email: 'a@example.test' }),
    ])
    expect(Object.keys(exported[0]?.payload ?? {})).toEqual([
      'email',
      'plan',
      'zeta',
    ])
  })

  it('keeps non-scalar values structured rather than stringified', () => {
    const exported = toExportJson(definition, [
      submission({ tags: ['a', 'b'] }),
    ])
    expect(exported[0]?.payload.tags).toEqual(['a', 'b'])
  })

  it('serializes an empty submission set as an empty array', () => {
    expect(serializeSubmissionsToJson(definition, [])).toBe('[]\n')
  })
})
