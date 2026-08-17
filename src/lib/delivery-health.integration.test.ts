import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { deliveryAttempt, destination, destinationHealth } from '~/db/schema'
import {
  getDestinationHealth,
  recordDeliveryOutcome,
  type DeliveryHealthSignal,
  type HealthThresholds,
} from '~/lib/delivery-health'
import { runWorkerOnce, type DeliveryDispatcher } from '~/lib/queue'
import {
  addDestination,
  createForm,
  insertSubmission,
  resetDb,
} from '../../test/helpers'

beforeEach(resetDb)

/** Threshold of 2 keeps the worker-driven tests short; cool-off of an hour. */
const T: HealthThresholds = { threshold: 2, cooloffMs: 60 * 60_000 }

const failPermanent: DeliveryDispatcher = async () => ({
  ok: false,
  retryable: false,
  error: 'bad config',
})
const succeed: DeliveryDispatcher = async () => ({
  ok: true,
  responseStatus: 200,
})

/** Collect signals the way the worker will hand them to a real notifier. */
function collector() {
  const signals: DeliveryHealthSignal[] = []
  return {
    signals,
    notify: (signal: DeliveryHealthSignal) => {
      signals.push(signal)
    },
  }
}

async function seedDestination() {
  const f = await createForm()
  const dest = await addDestination(f.id)
  return { formId: f.id, destinationId: dest.id }
}

/** Queue one attempt for the destination and drain it with `dispatch`. */
async function deliverOnce(
  formId: string,
  destinationId: string,
  dispatch: DeliveryDispatcher,
  notify: (signal: DeliveryHealthSignal) => void,
) {
  const sub = await insertSubmission(formId)
  await db
    .insert(deliveryAttempt)
    .values({ submissionId: sub.id, destinationId })
  await runWorkerOnce(dispatch, 10, notify)
}

describe('delivery-health persistence (D-010)', () => {
  it('tracks consecutive dead-letters and alerts once at the threshold', async () => {
    const { destinationId } = await seedDestination()
    const { signals, notify } = collector()

    for (const minute of [0, 1, 2, 3]) {
      const signal = await recordDeliveryOutcome(
        destinationId,
        { type: 'dead_letter', error: 'boom' },
        new Date(Date.UTC(2026, 7, 1, 0, minute)),
        T,
      )
      if (signal) notify(signal)
    }

    expect(signals).toHaveLength(1)
    expect(signals[0]).toMatchObject({ kind: 'unhealthy', destinationId })

    const state = await getDestinationHealth(destinationId)
    expect(state.consecutiveDeadLetters).toBe(4)
    expect(state.unhealthySince).not.toBeNull()
    expect(state.lastError).toBe('boom')
  })

  it('survives a restart: suppression state is read back from the database', async () => {
    const { destinationId } = await seedDestination()
    const now = new Date(Date.UTC(2026, 7, 1, 0, 0))
    await recordDeliveryOutcome(destinationId, { type: 'dead_letter' }, now, T)
    await recordDeliveryOutcome(destinationId, { type: 'dead_letter' }, now, T)

    // Nothing in memory carries over — the next call re-reads the row.
    const persisted = await getDestinationHealth(destinationId)
    expect(persisted.lastNotifiedAt).toEqual(now)

    const repeat = await recordDeliveryOutcome(
      destinationId,
      { type: 'dead_letter' },
      new Date(now.getTime() + 60_000),
      T,
    )
    expect(repeat).toBeNull()
  })

  it('resets on success and reports recovery', async () => {
    const { destinationId } = await seedDestination()
    const now = new Date(Date.UTC(2026, 7, 1, 0, 0))
    await recordDeliveryOutcome(destinationId, { type: 'dead_letter' }, now, T)
    await recordDeliveryOutcome(destinationId, { type: 'dead_letter' }, now, T)

    const signal = await recordDeliveryOutcome(
      destinationId,
      { type: 'success' },
      new Date(now.getTime() + 120_000),
      T,
    )
    expect(signal).toMatchObject({ kind: 'recovered', destinationId })

    const state = await getDestinationHealth(destinationId)
    expect(state.consecutiveDeadLetters).toBe(0)
    expect(state.unhealthySince).toBeNull()
    expect(state.lastNotifiedAt).toBeNull()
  })

  it('reports no health for a destination that has never delivered', async () => {
    const { destinationId } = await seedDestination()
    const state = await getDestinationHealth(destinationId)
    expect(state.consecutiveDeadLetters).toBe(0)
    expect(state.unhealthySince).toBeNull()
  })

  it('drops health state when the destination is deleted', async () => {
    const { destinationId } = await seedDestination()
    await recordDeliveryOutcome(
      destinationId,
      { type: 'dead_letter' },
      new Date(),
      T,
    )
    await db.delete(destination).where(eq(destination.id, destinationId))

    const rows = await db
      .select()
      .from(destinationHealth)
      .where(eq(destinationHealth.destinationId, destinationId))
    expect(rows).toHaveLength(0)
  })
})

describe('delivery-health wiring into the worker', () => {
  it('counts dead-letters from the worker and leaves the notifier out of the retry path', async () => {
    const { formId, destinationId } = await seedDestination()
    const { signals, notify } = collector()

    // Non-retryable failures dead-letter on the first attempt.
    await deliverOnce(formId, destinationId, failPermanent, notify)
    await deliverOnce(formId, destinationId, failPermanent, notify)
    await deliverOnce(formId, destinationId, failPermanent, notify)

    const state = await getDestinationHealth(destinationId)
    expect(state.consecutiveDeadLetters).toBe(3)
    // Default threshold is 3, cool-off 24h — one alert, not three.
    expect(signals.filter((s) => s.kind === 'unhealthy')).toHaveLength(1)
  })

  it('does not count a retryable failure that still has an attempt queued', async () => {
    const { formId, destinationId } = await seedDestination()
    const { signals, notify } = collector()
    const failRetryable: DeliveryDispatcher = async () => ({
      ok: false,
      retryable: true,
      error: 'transient',
    })

    await deliverOnce(formId, destinationId, failRetryable, notify)

    const state = await getDestinationHealth(destinationId)
    expect(state.consecutiveDeadLetters).toBe(0)
    expect(signals).toHaveLength(0)
  })

  it('clears the counter when a later delivery succeeds', async () => {
    const { formId, destinationId } = await seedDestination()
    const { notify } = collector()

    await deliverOnce(formId, destinationId, failPermanent, notify)
    expect(
      (await getDestinationHealth(destinationId)).consecutiveDeadLetters,
    ).toBe(1)

    await deliverOnce(formId, destinationId, succeed, notify)
    expect(
      (await getDestinationHealth(destinationId)).consecutiveDeadLetters,
    ).toBe(0)
  })

  it('keeps delivering when the notifier throws', async () => {
    const { formId, destinationId } = await seedDestination()
    const exploding = () => {
      throw new Error('mail provider down')
    }

    for (let i = 0; i < 3; i++) {
      await deliverOnce(formId, destinationId, failPermanent, exploding)
    }

    const attempts = await db.select().from(deliveryAttempt)
    expect(attempts).toHaveLength(3)
    expect(attempts.every((a) => a.status === 'dead_letter')).toBe(true)
    expect(
      (await getDestinationHealth(destinationId)).consecutiveDeadLetters,
    ).toBe(3)
  })
})
