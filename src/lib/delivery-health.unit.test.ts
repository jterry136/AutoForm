import { describe, expect, it } from 'vitest'
import {
  evaluateHealth,
  initialHealthState,
  type HealthState,
  type HealthThresholds,
} from '~/lib/delivery-health'

/**
 * The detection rule (D-010) as a pure transition — no DB, no mail provider.
 * The integration test covers the wiring; this covers the policy.
 */

const T: HealthThresholds = { threshold: 3, cooloffMs: 60 * 60_000 }

const t0 = new Date('2026-08-01T00:00:00.000Z')
const at = (minutes: number) => new Date(t0.getTime() + minutes * 60_000)

const deadLetter = (error: string | null = 'boom') =>
  ({ type: 'dead_letter', error }) as const
const success = { type: 'success' } as const

/** Feed a run of dead-letters through the transition, returning the end state. */
function deadLetters(
  count: number,
  state: HealthState = initialHealthState,
  startMinute = 0,
): { state: HealthState; signals: number } {
  let signals = 0
  for (let i = 0; i < count; i++) {
    const result = evaluateHealth(state, deadLetter(), at(startMinute + i), T)
    state = result.next
    if (result.signal) signals++
  }
  return { state, signals }
}

describe('evaluateHealth — threshold', () => {
  it('stays silent below the threshold', () => {
    const { state, signals } = deadLetters(2)
    expect(signals).toBe(0)
    expect(state.consecutiveDeadLetters).toBe(2)
    expect(state.unhealthySince).toBeNull()
    expect(state.lastNotifiedAt).toBeNull()
  })

  it('emits exactly one unhealthy signal at the threshold', () => {
    const { state, signals } = deadLetters(3)
    expect(signals).toBe(1)
    expect(state.consecutiveDeadLetters).toBe(3)
    expect(state.unhealthySince).toEqual(at(2))
    expect(state.lastNotifiedAt).toEqual(at(2))
  })

  it('carries the failure count and latest error on the signal', () => {
    const { state } = deadLetters(2)
    const { signal } = evaluateHealth(
      state,
      deadLetter('502 from host'),
      at(9),
      T,
    )
    expect(signal).toEqual({
      kind: 'unhealthy',
      consecutiveDeadLetters: 3,
      since: at(9),
      lastError: '502 from host',
    })
  })

  it('honours a threshold of 1', () => {
    const { signal } = evaluateHealth(initialHealthState, deadLetter(), t0, {
      ...T,
      threshold: 1,
    })
    expect(signal?.kind).toBe('unhealthy')
  })
})

describe('evaluateHealth — cool-off', () => {
  it('suppresses repeat alerts inside the cool-off window', () => {
    const { state } = deadLetters(3)
    // 30 more failures over the next 30 minutes, all inside the 60m cool-off.
    const { state: later, signals } = deadLetters(30, state, 3)
    expect(signals).toBe(0)
    expect(later.consecutiveDeadLetters).toBe(33)
    // The outage start is preserved across suppressed alerts.
    expect(later.unhealthySince).toEqual(at(2))
    expect(later.lastNotifiedAt).toEqual(at(2))
  })

  it('re-alerts once the cool-off has elapsed', () => {
    const { state } = deadLetters(3)
    const { signal, next } = evaluateHealth(state, deadLetter(), at(62), T)
    expect(signal?.kind).toBe('unhealthy')
    expect(next.lastNotifiedAt).toEqual(at(62))
    expect(next.unhealthySince).toEqual(at(2))
  })

  it('treats an elapsed time exactly equal to the cool-off as cooled off', () => {
    const { state } = deadLetters(3)
    const { signal } = evaluateHealth(state, deadLetter(), at(2 + 60), T)
    expect(signal?.kind).toBe('unhealthy')
  })
})

describe('evaluateHealth — recovery', () => {
  it('resets the counter and clears the flag on success', () => {
    const { state } = deadLetters(3)
    const { next } = evaluateHealth(state, success, at(10), T)
    expect(next.consecutiveDeadLetters).toBe(0)
    expect(next.unhealthySince).toBeNull()
    expect(next.lastNotifiedAt).toBeNull()
    expect(next.lastError).toBeNull()
    expect(next.lastSuccessAt).toEqual(at(10))
  })

  it('emits recovered only when the owner was actually alerted', () => {
    const alerted = deadLetters(3).state
    expect(evaluateHealth(alerted, success, at(10), T).signal).toEqual({
      kind: 'recovered',
      recoveredAt: at(10),
    })

    const belowThreshold = deadLetters(2).state
    expect(evaluateHealth(belowThreshold, success, at(10), T).signal).toBeNull()
  })

  it('never signals for a destination that has only ever succeeded', () => {
    const { next, signal } = evaluateHealth(initialHealthState, success, t0, T)
    expect(signal).toBeNull()
    expect(next.consecutiveDeadLetters).toBe(0)
  })

  it('starts a fresh outage after a recovery rather than reusing the old one', () => {
    const recovered = evaluateHealth(
      deadLetters(3).state,
      success,
      at(10),
      T,
    ).next
    const { state, signals } = deadLetters(3, recovered, 20)
    expect(signals).toBe(1)
    expect(state.unhealthySince).toEqual(at(22))
  })
})
