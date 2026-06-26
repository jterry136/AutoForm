import { afterEach, describe, expect, it } from 'vitest'
import { checkRateLimit, isHoneypotTripped, resetRateLimits } from '~/lib/spam'

afterEach(resetRateLimits)

describe('isHoneypotTripped (FR-SPAM-1)', () => {
  it('is false for empty / missing values, true for any content', () => {
    expect(isHoneypotTripped(undefined)).toBe(false)
    expect(isHoneypotTripped('')).toBe(false)
    expect(isHoneypotTripped('   ')).toBe(false)
    expect(isHoneypotTripped([])).toBe(false)
    expect(isHoneypotTripped('bot')).toBe(true)
    expect(isHoneypotTripped(['', 'x'])).toBe(true)
  })
})

describe('checkRateLimit (FR-SPAM-2)', () => {
  it('allows up to the limit, then denies with a retry hint', () => {
    const key = 'k1'
    expect(checkRateLimit(key, 3).allowed).toBe(true)
    expect(checkRateLimit(key, 3).allowed).toBe(true)
    expect(checkRateLimit(key, 3).allowed).toBe(true)
    const denied = checkRateLimit(key, 3)
    expect(denied.allowed).toBe(false)
    expect(denied.retryAfterSec).toBeGreaterThan(0)
  })

  it('tracks keys independently', () => {
    expect(checkRateLimit('a', 1).allowed).toBe(true)
    expect(checkRateLimit('a', 1).allowed).toBe(false)
    expect(checkRateLimit('b', 1).allowed).toBe(true)
  })

  it('resets after the window elapses', async () => {
    expect(checkRateLimit('w', 1, 40).allowed).toBe(true)
    expect(checkRateLimit('w', 1, 40).allowed).toBe(false)
    await new Promise((r) => setTimeout(r, 60))
    expect(checkRateLimit('w', 1, 40).allowed).toBe(true)
  })
})
