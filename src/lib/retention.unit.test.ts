import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import {
  MAX_RETENTION_DAYS,
  describeRetention,
  retentionDaysSchema,
  retentionMode,
  retentionNeedsConfirmation,
} from '~/lib/retention'

describe('retention policy vocabulary (D-011)', () => {
  it('maps the three states onto one nullable integer', () => {
    expect(retentionMode(null)).toBe('indefinite')
    expect(retentionMode(0)).toBe('zero')
    expect(retentionMode(1)).toBe('days')
    expect(retentionMode(90)).toBe('days')
  })

  it('describes each state in plain language', () => {
    expect(describeRetention(null)).toMatch(/until you delete/i)
    expect(describeRetention(0)).toMatch(/purged/i)
    expect(describeRetention(1)).toContain('1 day.')
    expect(describeRetention(30)).toContain('30 days.')
  })
})

describe('retentionDaysSchema', () => {
  const accepts = (value: unknown) =>
    !(retentionDaysSchema(value) instanceof type.errors)

  it('accepts the three valid shapes', () => {
    expect(accepts(null)).toBe(true)
    expect(accepts(0)).toBe(true)
    expect(accepts(1)).toBe(true)
    expect(accepts(90)).toBe(true)
    expect(accepts(MAX_RETENTION_DAYS)).toBe(true)
  })

  it('rejects out-of-range, fractional, and non-numeric values', () => {
    expect(accepts(-1)).toBe(false)
    expect(accepts(MAX_RETENTION_DAYS + 1)).toBe(false)
    expect(accepts(1.5)).toBe(false)
    expect(accepts(Number.NaN)).toBe(false)
    expect(accepts('90')).toBe(false)
    expect(accepts('forever')).toBe(false)
    expect(accepts(undefined)).toBe(false)
    expect(accepts({})).toBe(false)
  })
})

describe('retentionNeedsConfirmation (D-011 §4)', () => {
  it('confirms anything that shortens the window', () => {
    // Bounding an unbounded window loses everything older than the new one.
    expect(retentionNeedsConfirmation(null, 30)).toBe(true)
    expect(retentionNeedsConfirmation(365, 30)).toBe(true)
    expect(retentionNeedsConfirmation(2, 1)).toBe(true)
  })

  it('confirms turning zero-retention on, but not re-saving it', () => {
    expect(retentionNeedsConfirmation(null, 0)).toBe(true)
    expect(retentionNeedsConfirmation(30, 0)).toBe(true)
    expect(retentionNeedsConfirmation(0, 0)).toBe(false)
  })

  it('does not confirm lengthening, an unchanged window, or going indefinite', () => {
    expect(retentionNeedsConfirmation(30, 365)).toBe(false)
    expect(retentionNeedsConfirmation(30, 30)).toBe(false)
    expect(retentionNeedsConfirmation(0, 30)).toBe(false)
    expect(retentionNeedsConfirmation(30, null)).toBe(false)
    expect(retentionNeedsConfirmation(null, null)).toBe(false)
  })
})
