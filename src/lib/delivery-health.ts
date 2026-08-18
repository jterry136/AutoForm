import { eq } from 'drizzle-orm'
import { db } from '~/db'
import { destinationHealth } from '~/db/schema'
import { env } from '~/lib/env'

/**
 * Delivery-health detection (FR-NOTIF-1, NFR-OBS-1).
 *
 * Decides *when* a destination counts as unhealthy and remembers enough to avoid
 * telling its owner about the same outage once per failed submission. Sending the
 * notification is not this module's job — it emits a `DeliveryHealthSignal` and
 * hands it to an injectable `DeliveryHealthNotifier` so the detection half is
 * testable without a mail provider.
 *
 * The rule (DECISIONS.md D-010): count **consecutive dead-letters** per
 * destination; at the threshold the destination is flagged unhealthy and one
 * signal is emitted, then suppressed for a cool-off window. Any success resets
 * the counter and clears the flag.
 *
 * Evaluated event-driven at the moment a delivery reaches a terminal state in
 * `src/lib/queue.ts` — never in the ingestion path (P-3).
 *
 * Server-only (imports the DB client).
 */

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Consecutive dead-letters before a destination is flagged unhealthy. */
const DEFAULT_THRESHOLD = 3
/** Minimum gap between two notifications about the same destination. */
const DEFAULT_COOLOFF_MINUTES = 24 * 60

export interface HealthThresholds {
  /** Consecutive dead-letters that trip the unhealthy flag. Always ≥ 1. */
  readonly threshold: number
  /** Suppression window after a notification, in milliseconds. Always ≥ 0. */
  readonly cooloffMs: number
}

/** Env-tunable thresholds, clamped so a nonsensical value can't disable detection. */
export function healthThresholds(): HealthThresholds {
  const threshold = Math.max(
    1,
    env.DELIVERY_HEALTH_THRESHOLD ?? DEFAULT_THRESHOLD,
  )
  const cooloffMinutes = Math.max(
    0,
    env.DELIVERY_HEALTH_COOLOFF_MINUTES ?? DEFAULT_COOLOFF_MINUTES,
  )
  return { threshold, cooloffMs: cooloffMinutes * 60_000 }
}

// ─── Signals ─────────────────────────────────────────────────────────────────

/**
 * What the notifier receives. `unhealthy` is emitted once per outage (then
 * suppressed for the cool-off); `recovered` closes the loop for an owner who was
 * told about an outage that has since cleared.
 */
export type HealthSignal =
  | {
      readonly kind: 'unhealthy'
      readonly consecutiveDeadLetters: number
      /** When this outage started (the dead-letter that tripped the threshold). */
      readonly since: Date
      readonly lastError: string | null
    }
  | { readonly kind: 'recovered'; readonly recoveredAt: Date }

/** A signal once the persistence layer has attached the destination it belongs to. */
export type DeliveryHealthSignal = HealthSignal & {
  readonly destinationId: string
}

/** Injected by the worker; replaced by the owner-email sender in a later chunk. */
export type DeliveryHealthNotifier = (
  signal: DeliveryHealthSignal,
) => Promise<void> | void

/** Default: log only (NFR-OBS-1). Never throws — the worker must not stall. */
export const logOnlyNotifier: DeliveryHealthNotifier = (signal) => {
  if (signal.kind === 'unhealthy') {
    console.warn(
      `[delivery-health] destination ${signal.destinationId} unhealthy after ` +
        `${signal.consecutiveDeadLetters} consecutive dead-letters: ${signal.lastError ?? 'no error recorded'}`,
    )
  } else {
    console.log(
      `[delivery-health] destination ${signal.destinationId} recovered`,
    )
  }
}

// ─── Pure evaluation core ────────────────────────────────────────────────────

/** The persisted state, as a plain value so the transition is pure. */
export interface HealthState {
  readonly consecutiveDeadLetters: number
  readonly unhealthySince: Date | null
  readonly lastNotifiedAt: Date | null
  readonly lastDeadLetterAt: Date | null
  readonly lastSuccessAt: Date | null
  readonly lastError: string | null
}

export const initialHealthState: HealthState = {
  consecutiveDeadLetters: 0,
  unhealthySince: null,
  lastNotifiedAt: null,
  lastDeadLetterAt: null,
  lastSuccessAt: null,
  lastError: null,
}

export type HealthEvent =
  | { readonly type: 'dead_letter'; readonly error?: string | null }
  | { readonly type: 'success' }

export interface HealthTransition {
  readonly next: HealthState
  /** null when nothing should be sent (below threshold, or within cool-off). */
  readonly signal: HealthSignal | null
}

/**
 * The whole detection rule, as a pure function of (state, event, now).
 *
 * - A dead-letter increments the consecutive counter. At or above the threshold
 *   the destination is unhealthy; a signal is emitted only if nothing has been
 *   sent yet or the cool-off has elapsed, and `lastNotifiedAt` moves so repeats
 *   are suppressed.
 * - A success always resets the counter and clears the unhealthy flag. It emits
 *   `recovered` only if the owner was actually told about the outage — a
 *   destination that failed twice and then succeeded is a non-event.
 * - `failed` (a retry is still queued) is not an event here: only terminal
 *   outcomes are evaluated.
 */
export function evaluateHealth(
  state: HealthState,
  event: HealthEvent,
  now: Date,
  thresholds: HealthThresholds,
): HealthTransition {
  if (event.type === 'success') {
    const wasAlerted =
      state.unhealthySince !== null && state.lastNotifiedAt !== null
    return {
      next: {
        ...initialHealthState,
        lastDeadLetterAt: state.lastDeadLetterAt,
        lastSuccessAt: now,
        lastError: null,
      },
      signal: wasAlerted ? { kind: 'recovered', recoveredAt: now } : null,
    }
  }

  const consecutiveDeadLetters = state.consecutiveDeadLetters + 1
  const lastError = event.error ?? null
  const unhealthy = consecutiveDeadLetters >= thresholds.threshold
  const unhealthySince = unhealthy ? (state.unhealthySince ?? now) : null

  const cooledOff =
    state.lastNotifiedAt === null ||
    now.getTime() - state.lastNotifiedAt.getTime() >= thresholds.cooloffMs
  const notify = unhealthy && cooledOff

  return {
    next: {
      consecutiveDeadLetters,
      unhealthySince,
      lastNotifiedAt: notify ? now : state.lastNotifiedAt,
      lastDeadLetterAt: now,
      lastSuccessAt: state.lastSuccessAt,
      lastError,
    },
    signal: notify
      ? {
          kind: 'unhealthy',
          consecutiveDeadLetters,
          // `unhealthySince` is non-null whenever `unhealthy` is true.
          since: unhealthySince ?? now,
          lastError,
        }
      : null,
  }
}

// ─── Persistence ─────────────────────────────────────────────────────────────

type HealthRow = typeof destinationHealth.$inferSelect

function toState(row: HealthRow): HealthState {
  return {
    consecutiveDeadLetters: row.consecutiveDeadLetters,
    unhealthySince: row.unhealthySince,
    lastNotifiedAt: row.lastNotifiedAt,
    lastDeadLetterAt: row.lastDeadLetterAt,
    lastSuccessAt: row.lastSuccessAt,
    lastError: row.lastError,
  }
}

/** Read a destination's health, or the initial state if it has none yet. */
export async function getDestinationHealth(
  destinationId: string,
): Promise<HealthState> {
  const [row] = await db
    .select()
    .from(destinationHealth)
    .where(eq(destinationHealth.destinationId, destinationId))
  return row ? toState(row) : initialHealthState
}

/**
 * Apply one terminal delivery outcome to a destination's health and return the
 * signal to notify on, if any.
 *
 * The read-modify-write runs inside a transaction over a row locked `FOR UPDATE`,
 * so two workers dead-lettering for the same destination at the same moment can't
 * both see the pre-threshold count and both alert. The row is created first with
 * `ON CONFLICT DO NOTHING` so there is always something to lock.
 */
export async function recordDeliveryOutcome(
  destinationId: string,
  event: HealthEvent,
  now: Date = new Date(),
  thresholds: HealthThresholds = healthThresholds(),
): Promise<DeliveryHealthSignal | null> {
  await db
    .insert(destinationHealth)
    .values({ destinationId })
    .onConflictDoNothing()

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(destinationHealth)
      .where(eq(destinationHealth.destinationId, destinationId))
      .for('update')
    // The destination was deleted between the upsert and the lock — nothing to track.
    if (!row) return null

    const { next, signal } = evaluateHealth(
      toState(row),
      event,
      now,
      thresholds,
    )

    await tx
      .update(destinationHealth)
      .set({
        consecutiveDeadLetters: next.consecutiveDeadLetters,
        unhealthySince: next.unhealthySince,
        lastNotifiedAt: next.lastNotifiedAt,
        lastDeadLetterAt: next.lastDeadLetterAt,
        lastSuccessAt: next.lastSuccessAt,
        lastError: next.lastError,
      })
      .where(eq(destinationHealth.destinationId, destinationId))

    return signal ? { ...signal, destinationId } : null
  })
}

/**
 * Evaluate an outcome and hand any signal to the notifier. Never throws: a
 * failure to detect or notify must not crash or stall delivery (NFR-REL-2/3).
 */
export async function reportDeliveryOutcome(
  destinationId: string,
  event: HealthEvent,
  notify: DeliveryHealthNotifier = logOnlyNotifier,
): Promise<void> {
  try {
    const signal = await recordDeliveryOutcome(destinationId, event)
    if (signal) await notify(signal)
  } catch (err) {
    console.error(
      '[delivery-health] failed to evaluate destination health:',
      err instanceof Error ? err.message : String(err),
    )
  }
}
