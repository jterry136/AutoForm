import { describe, expect, it } from 'vitest'
import { computeBackoffMs } from '~/lib/queue'

describe('computeBackoffMs — exponential backoff with equal jitter (D-006)', () => {
  it('grows exponentially per attempt, staying within the jittered band', () => {
    // base=2000, equal jitter → result ∈ [base·2^(n-1)/2, base·2^(n-1)).
    for (const [attempt, lo, hi] of [
      [1, 1_000, 2_000],
      [2, 2_000, 4_000],
      [3, 4_000, 8_000],
    ] as const) {
      for (let i = 0; i < 50; i++) {
        const ms = computeBackoffMs(attempt)
        expect(ms).toBeGreaterThanOrEqual(lo)
        expect(ms).toBeLessThan(hi)
      }
    }
  })

  it('caps at the maximum backoff for large attempt numbers', () => {
    // Cap is 5 minutes; with equal jitter the result stays ≤ cap.
    for (let i = 0; i < 50; i++) {
      const ms = computeBackoffMs(100)
      expect(ms).toBeGreaterThan(0)
      expect(ms).toBeLessThanOrEqual(5 * 60_000)
    }
  })
})
