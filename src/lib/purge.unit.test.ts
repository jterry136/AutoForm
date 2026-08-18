import { describe, expect, it } from 'vitest'
import { decidePurge, ZERO_RETENTION_CEILING_MS } from '~/lib/purge'

/**
 * The zero-retention purge decision in isolation (FR-SUB-3, D-011 §2): may this
 * submission's content go yet? The pass that acts on it is exercised against a
 * real database in purge.integration.test.ts.
 */

const HOUR = 60 * 60_000

describe('decidePurge — terminal delivery (D-011 §2)', () => {
  it('purges once every attempt succeeded', () => {
    expect(decidePurge(['succeeded', 'succeeded'], HOUR)).toEqual({
      purge: true,
      reason: 'terminal',
    })
  })

  it('purges a dead-lettered submission — the attempt is over either way', () => {
    expect(decidePurge(['dead_letter'], HOUR)).toEqual({
      purge: true,
      reason: 'terminal',
    })
  })

  it('purges a mix of succeeded and dead-lettered destinations', () => {
    expect(decidePurge(['succeeded', 'dead_letter'], HOUR).purge).toBe(true)
  })

  it('treats "no attempts at all" as terminal — nothing left to deliver', () => {
    expect(decidePurge([], HOUR)).toEqual({ purge: true, reason: 'terminal' })
  })

  it('treats a `failed` latest attempt as terminal only when nothing is queued', () => {
    // `failed` always has a successor `pending` row (D-006), so in practice the
    // pending row is what holds the submission — a lone `failed` does not.
    expect(decidePurge(['failed'], HOUR).purge).toBe(true)
    expect(decidePurge(['failed', 'pending'], HOUR).purge).toBe(false)
  })
})

describe('decidePurge — in flight and the 24h ceiling', () => {
  it('holds a submission with a pending attempt', () => {
    expect(decidePurge(['pending'], HOUR)).toEqual({
      purge: false,
      reason: 'in_flight',
    })
  })

  it('holds a submission being processed right now', () => {
    expect(decidePurge(['succeeded', 'processing'], HOUR).purge).toBe(false)
  })

  it('purges at the ceiling even while a destination is still retrying', () => {
    expect(decidePurge(['pending'], ZERO_RETENTION_CEILING_MS)).toEqual({
      purge: true,
      reason: 'ceiling',
    })
  })

  it('holds right up to the ceiling', () => {
    expect(decidePurge(['pending'], ZERO_RETENTION_CEILING_MS - 1).purge).toBe(
      false,
    )
  })

  it('honours an injected ceiling', () => {
    expect(decidePurge(['processing'], 5_000, 1_000).reason).toBe('ceiling')
    expect(decidePurge(['processing'], 500, 1_000).reason).toBe('in_flight')
  })
})
