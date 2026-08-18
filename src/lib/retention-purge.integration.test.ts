import { and, eq, inArray, isNull } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { deliveryAttempt, submission } from '~/db/schema'
import { runRetentionPassOnce } from '~/lib/retention-purge'
import {
  addDestination,
  createForm,
  insertSubmission,
  resetDb,
} from '../../test/helpers'

beforeEach(resetDb)

const DAY_MS = 24 * 60 * 60_000

/** A timestamp `days` days in the past. */
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS)
}

/**
 * Ids of a form's submissions that still hold their content. A purge redacts to
 * a tombstone rather than deleting (D-011 §3), so the row count never falls —
 * "how much is left" is a question about `purged_at`, not about row existence.
 */
async function unpurgedIdsFor(formId: string): Promise<string[]> {
  const rows = await db
    .select({ id: submission.id })
    .from(submission)
    .where(and(eq(submission.formId, formId), isNull(submission.purgedAt)))
  return rows.map((r) => r.id)
}

/** Whether the submission has been redacted to a tombstone. */
async function isPurged(id: string): Promise<boolean> {
  const [row] = await db
    .select({ purgedAt: submission.purgedAt })
    .from(submission)
    .where(eq(submission.id, id))
  if (!row)
    throw new Error(`submission ${id} vanished — purge must redact, not delete`)
  return row.purgedAt !== null
}

describe('retention purge pass', () => {
  it('purges submissions past the form retention window and keeps the rest', async () => {
    const form = await createForm({ retentionDays: 30 })
    const expired = await insertSubmission(form.id, { createdAt: daysAgo(45) })
    const justExpired = await insertSubmission(form.id, {
      createdAt: daysAgo(31),
    })
    const fresh = await insertSubmission(form.id, { createdAt: daysAgo(29) })
    const today = await insertSubmission(form.id)

    const summary = await runRetentionPassOnce()

    expect(summary.formsScanned).toBe(1)
    expect(summary.purged).toBe(2)
    expect(await isPurged(expired.id)).toBe(true)
    expect(await isPurged(justExpired.id)).toBe(true)
    expect(await isPurged(fresh.id)).toBe(false)
    expect(await isPurged(today.id)).toBe(false)
  })

  it('never touches forms with indefinite retention', async () => {
    const indefinite = await createForm({ retentionDays: null })
    const old = await insertSubmission(indefinite.id, {
      createdAt: daysAgo(500),
    })

    const summary = await runRetentionPassOnce()

    expect(summary.formsScanned).toBe(0)
    expect(summary.purged).toBe(0)
    expect(await isPurged(old.id)).toBe(false)
  })

  it('ignores non-positive retention windows rather than purging everything', async () => {
    // Zero-retention is a separate mode (settled by Q-3) implemented as a
    // post-delivery purge; the age-based pass must not act on it.
    const zero = await createForm({ retentionDays: 0 })
    const old = await insertSubmission(zero.id, { createdAt: daysAgo(90) })

    const summary = await runRetentionPassOnce()

    expect(summary.formsScanned).toBe(0)
    expect(await isPurged(old.id)).toBe(false)
  })

  it('purges each form against its own window', async () => {
    const shortForm = await createForm({ retentionDays: 7 })
    const longForm = await createForm({ retentionDays: 90 })
    const shortExpired = await insertSubmission(shortForm.id, {
      createdAt: daysAgo(10),
    })
    const longKept = await insertSubmission(longForm.id, {
      createdAt: daysAgo(10),
    })

    const summary = await runRetentionPassOnce()

    expect(summary.formsScanned).toBe(2)
    expect(summary.purged).toBe(1)
    expect(await isPurged(shortExpired.id)).toBe(true)
    expect(await isPurged(longKept.id)).toBe(false)
  })

  it('holds back submissions with an in-flight delivery, then purges them once terminal', async () => {
    const form = await createForm({ retentionDays: 30 })
    const dest = await addDestination(form.id)
    const inFlight = await insertSubmission(form.id, { createdAt: daysAgo(60) })
    const settled = await insertSubmission(form.id, { createdAt: daysAgo(60) })

    await db.insert(deliveryAttempt).values([
      { submissionId: inFlight.id, destinationId: dest.id, status: 'pending' },
      { submissionId: settled.id, destinationId: dest.id, status: 'succeeded' },
    ])

    const first = await runRetentionPassOnce()

    expect(first.purged).toBe(1)
    expect(first.heldBack).toBe(1)
    expect(await isPurged(inFlight.id)).toBe(false)
    expect(await isPurged(settled.id)).toBe(true)

    // Once the delivery reaches a terminal state, the next pass collects it.
    await db
      .update(deliveryAttempt)
      .set({ status: 'dead_letter' })
      .where(eq(deliveryAttempt.submissionId, inFlight.id))

    const second = await runRetentionPassOnce()

    expect(second.purged).toBe(1)
    expect(second.heldBack).toBe(0)
    expect(await isPurged(inFlight.id)).toBe(true)
  })

  it('holds back a submission while any one of its destinations is still in flight', async () => {
    const form = await createForm({ retentionDays: 1 })
    const a = await addDestination(form.id, 'webhook')
    const b = await addDestination(form.id, 'email')
    const sub = await insertSubmission(form.id, { createdAt: daysAgo(5) })

    await db.insert(deliveryAttempt).values([
      { submissionId: sub.id, destinationId: a.id, status: 'succeeded' },
      { submissionId: sub.id, destinationId: b.id, status: 'processing' },
    ])

    const summary = await runRetentionPassOnce()

    expect(summary.purged).toBe(0)
    expect(summary.heldBack).toBe(1)
    expect(await isPurged(sub.id)).toBe(false)
  })

  it('keeps delivery history when it redacts a submission (NFR-OBS-1)', async () => {
    const form = await createForm({ retentionDays: 1 })
    const dest = await addDestination(form.id)
    const sub = await insertSubmission(form.id, { createdAt: daysAgo(5) })
    await db.insert(deliveryAttempt).values({
      submissionId: sub.id,
      destinationId: dest.id,
      status: 'succeeded',
      responseStatus: 200,
      responseBody: 'echoed back the payload',
    })

    await runRetentionPassOnce()

    // The tombstone keeps the row and its delivery history, so "1 received, 1
    // delivered" stays reconstructable; only the content is gone (D-011 §3).
    expect(await isPurged(sub.id)).toBe(true)

    const [row] = await db
      .select({
        rawBody: submission.rawBody,
        normalizedPayload: submission.normalizedPayload,
      })
      .from(submission)
      .where(eq(submission.id, sub.id))
    expect(row?.rawBody).toBeNull()
    expect(row?.normalizedPayload).toEqual({})

    const attempts = await db
      .select({
        status: deliveryAttempt.status,
        responseStatus: deliveryAttempt.responseStatus,
        responseBody: deliveryAttempt.responseBody,
      })
      .from(deliveryAttempt)
      .where(eq(deliveryAttempt.submissionId, sub.id))
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.status).toBe('succeeded')
    expect(attempts[0]?.responseStatus).toBe(200)
    // A destination can echo the payload back, so this one field is cleared.
    expect(attempts[0]?.responseBody).toBeNull()
  })

  it('purges in bounded batches and drains the backlog over repeated passes', async () => {
    const form = await createForm({ retentionDays: 1 })
    for (let i = 0; i < 5; i++) {
      await insertSubmission(form.id, { createdAt: daysAgo(10 + i) })
    }

    // batchSize 2 × 1 batch per pass = at most 2 deletions per pass.
    const first = await runRetentionPassOnce({
      batchSize: 2,
      maxBatchesPerForm: 1,
    })
    expect(first.purged).toBe(2)
    expect(await unpurgedIdsFor(form.id)).toHaveLength(3)

    const second = await runRetentionPassOnce({
      batchSize: 2,
      maxBatchesPerForm: 1,
    })
    expect(second.purged).toBe(2)

    const third = await runRetentionPassOnce({
      batchSize: 2,
      maxBatchesPerForm: 1,
    })
    expect(third.purged).toBe(1)
    expect(await unpurgedIdsFor(form.id)).toHaveLength(0)
  })

  it('drains a multi-batch backlog within a single pass when batches allow', async () => {
    const form = await createForm({ retentionDays: 1 })
    for (let i = 0; i < 5; i++) {
      await insertSubmission(form.id, { createdAt: daysAgo(10 + i) })
    }

    const summary = await runRetentionPassOnce({ batchSize: 2 })

    expect(summary.purged).toBe(5)
    expect(await unpurgedIdsFor(form.id)).toHaveLength(0)
  })

  it('terminates when every candidate in a batch is held back', async () => {
    const form = await createForm({ retentionDays: 1 })
    const dest = await addDestination(form.id)
    const ids: string[] = []
    for (let i = 0; i < 4; i++) {
      const sub = await insertSubmission(form.id, {
        createdAt: daysAgo(10 + i),
      })
      ids.push(sub.id)
    }
    await db.insert(deliveryAttempt).values(
      ids.map((submissionId) => ({
        submissionId,
        destinationId: dest.id,
        status: 'pending' as const,
      })),
    )

    const summary = await runRetentionPassOnce({ batchSize: 2 })

    expect(summary.purged).toBe(0)
    const remaining = await db
      .select({ id: submission.id })
      .from(submission)
      .where(and(inArray(submission.id, ids), isNull(submission.purgedAt)))
    expect(remaining).toHaveLength(4)
  })

  it('uses the injected clock for the cutoff', async () => {
    const form = await createForm({ retentionDays: 30 })
    const sub = await insertSubmission(form.id, { createdAt: daysAgo(10) })

    // With "now" pulled 10 days back, a 10-day-old submission is 20 days inside
    // a 30-day window and must survive.
    const past = await runRetentionPassOnce({ now: daysAgo(10) })
    expect(past.purged).toBe(0)
    expect(await isPurged(sub.id)).toBe(false)

    // Fast-forward far enough that it is expired.
    const future = await runRetentionPassOnce({
      now: new Date(Date.now() + 30 * DAY_MS),
    })
    expect(future.purged).toBe(1)
    expect(await isPurged(sub.id)).toBe(true)
  })

  it('is safe to run concurrently — a double pass purges each row once', async () => {
    const form = await createForm({ retentionDays: 1 })
    for (let i = 0; i < 6; i++) {
      await insertSubmission(form.id, { createdAt: daysAgo(10 + i) })
    }

    const [a, b] = await Promise.all([
      runRetentionPassOnce({ batchSize: 3 }),
      runRetentionPassOnce({ batchSize: 3 }),
    ])

    expect(a.purged + b.purged).toBe(6)
    expect(await unpurgedIdsFor(form.id)).toHaveLength(0)
  })

  it('reports a summary for observability', async () => {
    const form = await createForm({ retentionDays: 1 })
    await insertSubmission(form.id, { createdAt: daysAgo(5) })

    const summary = await runRetentionPassOnce()

    expect(summary).toMatchObject({ formsScanned: 1, purged: 1, heldBack: 0 })
    expect(summary.durationMs).toBeGreaterThanOrEqual(0)
  })
})
