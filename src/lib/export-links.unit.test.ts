import { describe, expect, it } from 'vitest'
import { parseExportFormat } from '~/lib/export-download'
import { EXPORT_FORMAT_OPTIONS, exportDownloadPath } from '~/lib/export-links'

/**
 * The dashboard's side of export: the URL the inbox menu points at, and the
 * formats it offers. Cheap to check, and the only place the client and the
 * endpoint have to agree.
 */

const FORM_ID = '6f1d2b4a-9c3e-4f5a-8b7c-0d1e2f3a4b5c'

describe('exportDownloadPath', () => {
  it('points at the authenticated export endpoint for the requested format', () => {
    expect(exportDownloadPath(FORM_ID, 'csv')).toBe(
      `/api/forms/${FORM_ID}/export?format=csv`,
    )
    expect(exportDownloadPath(FORM_ID, 'json')).toBe(
      `/api/forms/${FORM_ID}/export?format=json`,
    )
  })

  it('encodes the form id so it cannot escape its path segment', () => {
    expect(exportDownloadPath('../../etc/passwd', 'csv')).toBe(
      '/api/forms/..%2F..%2Fetc%2Fpasswd/export?format=csv',
    )
    expect(exportDownloadPath('a b?x=1#y', 'json')).toBe(
      '/api/forms/a%20b%3Fx%3D1%23y/export?format=json',
    )
  })
})

describe('EXPORT_FORMAT_OPTIONS', () => {
  it('offers csv first, then json', () => {
    expect(EXPORT_FORMAT_OPTIONS.map((o) => o.format)).toEqual(['csv', 'json'])
  })

  it('only offers formats the endpoint accepts', () => {
    for (const { format } of EXPORT_FORMAT_OPTIONS) {
      expect(parseExportFormat(format)).toBe(format)
    }
  })

  it('labels every option for the menu item’s accessible name', () => {
    for (const { label } of EXPORT_FORMAT_OPTIONS) {
      expect(label.trim().length).toBeGreaterThan(0)
    }
  })
})
