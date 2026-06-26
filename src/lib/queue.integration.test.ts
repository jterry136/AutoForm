import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { deliveryAttempt } from '~/db/schema'
import {
  reclaimStaleAttempts,
  runWorkerOnce,
  type DeliveryDispatcher,
} from '~/lib/queue'
import {
  addDestination,
  createForm,
  insertSubmission,
  resetDb,
} from '../../test/helpers'

beforeEach(resetDb)

const succeed: DeliveryDispatcher = async () => ({
  ok: true,
  responseStatus: 200,
  responseBody: 'ok',
})
const failRetryable: DeliveryDispatcher = async () => ({
  ok: false,
  retryable: true,
  error: 'transient',
})
const failPermanent: DeliveryDispatcher = async () => ({
  ok: false,
  retryable: false,
  error: 'bad config',
})

/** Seed one delivery_attempt row (with optional column overrides) ready to claim. */
async function seedAttempt(
  overrides: Partial<typeof deliveryAttempt.$inferInsert> = {},
) {
  const f = await createForm()
  const dest = await addDestination(f.id)
  const sub = await insertSubmission(f.id)
  const [row] = await db
    .insert(deliveryAttempt)
    .values({ submissionId: sub.id, destinationId: dest.id, ...overrides })
    .returning()
  if (!row) throw new Error('failed to seed attempt')
  return row
}

function rowsFor(submissionId: string) {
  return db
    .select()
    .from(deliveryAttempt)
    .where(eq(deliveryAttempt.submissionId, submissionId))
}

describe('delivery worker — claim, deliver, retry, dead-letter (Chunk 3 / D-006)', () => {
  it('marks an attempt succeeded on a successful delivery', async () => {
    const row = await seedAttempt()
    const processed = await runWorkerOnce(succeed)
    expect(processed).toBe(1)

    const [after] = await rowsFor(row.submissionId)
    expect(after?.status).toBe('succeeded')
    expect(after?.responseStatus).toBe(200)
    expect(after?.finishedAt).not.toBeNull()
  })

  it('on a retryable failure, marks the row failed and enqueues a backed-off successor', async () => {
    const row = await seedAttempt()
    await runWorkerOnce(failRetryable)

    const rows = await rowsFor(row.submissionId)
    expect(rows).toHaveLength(2)
    const failed = rows.find((r) => r.status === 'failed')
    const next = rows.find((r) => r.status === 'pending')
    expect(failed?.attempt).toBe(1)
    expect(next?.attempt).toBe(2)
    expect(next!.nextRunAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('dead-letters after the final attempt is exhausted', async () => {
    const row = await seedAttempt({ attempt: 5 }) // MAX_ATTEMPTS
    await runWorkerOnce(failRetryable)

    const rows = await rowsFor(row.submissionId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('dead_letter')
  })

  it('dead-letters immediately on a non-retryable failure', async () => {
    const row = await seedAttempt()
    await runWorkerOnce(failPermanent)

    const rows = await rowsFor(row.submissionId)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('dead_letter')
  })

  it('dead-letters when no connector is configured (default dispatcher)', async () => {
    const row = await seedAttempt()
    await runWorkerOnce() // default noop dispatcher
    const [after] = await rowsFor(row.submissionId)
    expect(after?.status).toBe('dead_letter')
  })

  it('does not claim attempts whose nextRunAt is in the future', async () => {
    const row = await seedAttempt({ nextRunAt: new Date(Date.now() + 60_000) })
    const processed = await runWorkerOnce(succeed)
    expect(processed).toBe(0)
    const [after] = await rowsFor(row.submissionId)
    expect(after?.status).toBe('pending')
  })

  it('reclaims a stale processing lock back to pending (crash recovery, NFR-REL-3)', async () => {
    const row = await seedAttempt({
      status: 'processing',
      lockedAt: new Date(Date.now() - 120_000),
      lockedBy: 'dead-worker',
    })
    const reclaimed = await reclaimStaleAttempts()
    expect(reclaimed).toBe(1)
    const [after] = await rowsFor(row.submissionId)
    expect(after?.status).toBe('pending')
    expect(after?.lockedAt).toBeNull()
  })

  it('claims each attempt exactly once under concurrent workers (FOR UPDATE SKIP LOCKED)', async () => {
    const f = await createForm()
    const dest = await addDestination(f.id)
    const subs = await Promise.all(
      [1, 2, 3, 4, 5].map(() => insertSubmission(f.id)),
    )
    await db
      .insert(deliveryAttempt)
      .values(subs.map((s) => ({ submissionId: s.id, destinationId: dest.id })))

    let calls = 0
    const slow: DeliveryDispatcher = async () => {
      calls++
      await new Promise((r) => setTimeout(r, 25))
      return { ok: true }
    }

    // Two workers drain concurrently; no row should be processed twice.
    const [a, b] = await Promise.all([
      runWorkerOnce(slow, 10),
      runWorkerOnce(slow, 10),
    ])
    expect(a + b).toBe(5)
    expect(calls).toBe(5)

    const all = await db.select().from(deliveryAttempt)
    expect(all).toHaveLength(5)
    expect(all.every((r) => r.status === 'succeeded')).toBe(true)
  })
})
