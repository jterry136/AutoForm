import { describe, expect, it } from 'vitest'
import { exportFilename, parseExportFormat } from '~/lib/export-download'

/**
 * Pure pieces of the download layer: format negotiation and the attachment
 * filename. The DB-backed behaviour (ownership, status codes, headers) is
 * covered by `export.integration.test.ts`.
 */

describe('parseExportFormat', () => {
  it('defaults to csv when the parameter is absent', () => {
    expect(parseExportFormat(null)).toBe('csv')
  })

  it('accepts csv and json, case- and space-insensitively', () => {
    expect(parseExportFormat('csv')).toBe('csv')
    expect(parseExportFormat('JSON')).toBe('json')
    expect(parseExportFormat(' json ')).toBe('json')
  })

  it('rejects anything else rather than guessing', () => {
    expect(parseExportFormat('xlsx')).toBeNull()
    expect(parseExportFormat('')).toBeNull()
    expect(parseExportFormat('csv,json')).toBeNull()
  })
})

describe('exportFilename', () => {
  const at = new Date('2026-03-09T18:04:00.000Z')

  it('slugs the form name and stamps the date', () => {
    expect(exportFilename('Contact Us', 'csv', at)).toBe(
      'contact-us-submissions-2026-03-09.csv',
    )
    expect(exportFilename('Contact Us', 'json', at)).toBe(
      'contact-us-submissions-2026-03-09.json',
    )
  })

  it('strips characters that could break the Content-Disposition header', () => {
    const name = exportFilename('Say "hi"; rm -rf /\n', 'csv', at)
    expect(name).toBe('say-hi-rm-rf-submissions-2026-03-09.csv')
    expect(name).not.toMatch(/["\\/\r\n;]/)
  })

  it('falls back to a generic name when nothing survives slugging', () => {
    expect(exportFilename('・・・', 'csv', at)).toBe(
      'form-submissions-2026-03-09.csv',
    )
  })

  it('caps the slug length without leaving a trailing separator', () => {
    const name = exportFilename('a'.repeat(60) + ' tail', 'csv', at)
    expect(name).toBe(`${'a'.repeat(40)}-submissions-2026-03-09.csv`)

    const cutOnSeparator = exportFilename(
      `${'b'.repeat(39)} tail`, // the 40th character is the separator
      'csv',
      at,
    )
    expect(cutOnSeparator).toBe(`${'b'.repeat(39)}-submissions-2026-03-09.csv`)
  })
})
