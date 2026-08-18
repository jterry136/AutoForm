import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { deliveryAttempt, form as formTable, submission } from '~/db/schema'
import { ingestSubmission } from '~/lib/ingest'
import { listSubmissionsForForm } from '~/lib/inbox'
import {
  redactSubmissions,
  runZeroRetentionPassOnce,
  ZERO_RETENTION_CEILING_MS,
} from '~/lib/purge'
import {
  enqueueDeliveries,
  runWorkerOnce,
  type DeliveryDispatcher,
} from '~/lib/queue'
import { resetRateLimits } from '~/lib/spam'
import {
  addDestination,
  createForm,
  insertSubmission,
  resetDb,
} from '../../test/helpers'

/**
 * Zero-retention end to end (FR-SUB-3, NFR-PRIV-1, D-011): a `retentionDays = 0`
 * form still persists before delivering (P-5) and still delivers, and the
 * content is gone once delivery is terminal — leaving a tombstone the inbox and
 * export can label rather than a hole where a submission used to be.
 */

beforeEach(async () => {
  await resetDb()
  resetRateLimits()
})

const succeed: DeliveryDispatcher = async () => ({
  ok: true,
  responseStatus: 200,
  responseBody: 'echoed: user@example.com',
})
const failPermanently: DeliveryDispatcher = async () => ({
  ok: false,
  retryable: false,
  error: 'destination rejected the payload',
})

/** Old enough to be outside the enqueue grace window. */
const MINUTES_AGO_5 = () => new Date(Date.now() - 5 * 60_000)

async function submissionRow(id: string) {
  const [row] = await db.select().from(submission).where(eq(submission.id, id))
  return row
}

async function attemptsFor(submissionId: string) {
  return db
    .select()
    .from(deliveryAttempt)
    .where(eq(deliveryAttempt.submissionId, submissionId))
}

/** A zero-retention form with one webhook destination and one queued submission. */
async function seedZeroRetention(options: { createdAt?: Date } = {}) {
  const f = await createForm({ retentionDays: 0 })
  const dest = await addDestination(f.id)
  const sub = await insertSubmission(f.id, {
    createdAt: options.createdAt ?? MINUTES_AGO_5(),
  })
  await enqueueDeliveries(sub.id, [dest.id])
  return { form: f, destination: dest, submission: sub }
}

describe('zero-retention: persist → deliver → purge (P-5, D-011 §2)', () => {
  it('still stores the submission on ingestion, before any delivery', async () => {
    const f = await createForm({ retentionDays: 0 })
    await addDestination(f.id, 'webhook')

    const result = await ingestSubmission(
      new Request('http://localhost/f/x', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email: 'user@example.com',
          message: 'hi',
        }).toString(),
      }),
      f.publicId,
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const row = await submissionRow(result.submissionId)
    expect(row?.purgedAt).toBeNull()
    expect(row?.normalizedPayload).toEqual({
      email: 'user@example.com',
      message: 'hi',
    })
    expect(await attemptsFor(result.submissionId)).toHaveLength(1)
  })

  it('delivers successfully, then purges the content on the next pass', async () => {
    const seeded = await seedZeroRetention()

    expect(await runWorkerOnce(succeed)).toBe(1)
    const delivered = await attemptsFor(seeded.submission.id)
    expect(delivered[0]?.status).toBe('succeeded')

    const summary = await runZeroRetentionPassOnce()
    expect(summary.purged).toBe(1)
    expect(summary.heldBack).toBe(0)

    const row = await submissionRow(seeded.submission.id)
    expect(row).toBeDefined()
    expect(row?.purgedAt).not.toBeNull()
    expect(row?.rawBody).toBeNull()
    expect(row?.normalizedPayload).toEqual({})
    expect(row?.referer).toBeNull()
    expect(row?.userAgent).toBeNull()
    expect(row?.clientFingerprint).toBeNull()
  })

  it('keeps the delivery record but clears the echoed response body (D-011 §3)', async () => {
    const seeded = await seedZeroRetention()
    await runWorkerOnce(succeed)
    await runZeroRetentionPassOnce()

    const attempts = await attemptsFor(seeded.submission.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.status).toBe('succeeded')
    expect(attempts[0]?.responseStatus).toBe(200)
    expect(attempts[0]?.responseBody).toBeNull()
  })

  it('purges a dead-lettered submission and keeps the failure reason', async () => {
    const seeded = await seedZeroRetention()
    await runWorkerOnce(failPermanently)

    const summary = await runZeroRetentionPassOnce()
    expect(summary.purged).toBe(1)

    const attempts = await attemptsFor(seeded.submission.id)
    expect(attempts[0]?.status).toBe('dead_letter')
    expect(attempts[0]?.error).toContain('destination rejected')
    expect((await submissionRow(seeded.submission.id))?.purgedAt).not.toBeNull()
  })

  it('purges a submission with no destinations at all', async () => {
    const f = await createForm({ retentionDays: 0 })
    const sub = await insertSubmission(f.id, { createdAt: MINUTES_AGO_5() })

    expect((await runZeroRetentionPassOnce()).purged).toBe(1)
    expect((await submissionRow(sub.id))?.purgedAt).not.toBeNull()
  })
})

describe('zero-retention: what the pass must not touch', () => {
  it('holds a submission whose delivery is still in flight', async () => {
    const seeded = await seedZeroRetention()

    const summary = await runZeroRetentionPassOnce()
    expect(summary.purged).toBe(0)
    expect(summary.heldBack).toBe(1)
    expect((await submissionRow(seeded.submission.id))?.rawBody).not.toBeNull()
  })

  it('purges an in-flight submission once it passes the 24h ceiling', async () => {
    const seeded = await seedZeroRetention({
      createdAt: new Date(Date.now() - ZERO_RETENTION_CEILING_MS - 60_000),
    })

    const summary = await runZeroRetentionPassOnce()
    expect(summary.purged).toBe(1)
    expect((await submissionRow(seeded.submission.id))?.purgedAt).not.toBeNull()
  })

  it('leaves a submission inside the enqueue grace window alone (P-5 race)', async () => {
    // A submission this new may still be between its INSERT and its enqueue, so
    // "no attempts" cannot yet be read as "nothing to deliver".
    const f = await createForm({ retentionDays: 0 })
    const sub = await insertSubmission(f.id)

    expect((await runZeroRetentionPassOnce()).scanned).toBe(0)
    expect((await submissionRow(sub.id))?.purgedAt).toBeNull()
  })

  it('ignores forms that retain indefinitely or for a fixed window', async () => {
    const indefinite = await createForm({ retentionDays: null })
    const bounded = await createForm({ retentionDays: 30 })
    const kept = await insertSubmission(indefinite.id, {
      createdAt: MINUTES_AGO_5(),
    })
    const alsoKept = await insertSubmission(bounded.id, {
      createdAt: MINUTES_AGO_5(),
    })

    const summary = await runZeroRetentionPassOnce()
    expect(summary.scanned).toBe(0)
    expect(summary.purged).toBe(0)
    expect((await submissionRow(kept.id))?.rawBody).not.toBeNull()
    expect((await submissionRow(alsoKept.id))?.rawBody).not.toBeNull()
  })

  it('is idempotent — a second pass re-purges nothing', async () => {
    const seeded = await seedZeroRetention()
    await runWorkerOnce(succeed)

    expect((await runZeroRetentionPassOnce()).purged).toBe(1)
    const firstStamp = (await submissionRow(seeded.submission.id))?.purgedAt

    const second = await runZeroRetentionPassOnce()
    expect(second.scanned).toBe(0)
    expect(second.purged).toBe(0)
    expect((await submissionRow(seeded.submission.id))?.purgedAt).toEqual(
      firstStamp,
    )
  })

  it('drains a backlog across batches', async () => {
    const f = await createForm({ retentionDays: 0 })
    for (let i = 0; i < 5; i++) {
      await insertSubmission(f.id, { createdAt: MINUTES_AGO_5() })
    }

    const summary = await runZeroRetentionPassOnce({ batchSize: 2 })
    expect(summary.scanned).toBe(5)
    expect(summary.purged).toBe(5)
  })
})

describe('delivery after a purge', () => {
  it('refuses to ship a purged submission and dead-letters the attempt', async () => {
    // The 24h ceiling can purge a submission whose destination is still stuck;
    // the queued attempt must fail loudly rather than deliver an empty payload.
    const seeded = await seedZeroRetention({
      createdAt: new Date(Date.now() - ZERO_RETENTION_CEILING_MS - 60_000),
    })
    expect((await runZeroRetentionPassOnce()).purged).toBe(1)

    expect(await runWorkerOnce(succeed)).toBe(1)
    const attempts = await attemptsFor(seeded.submission.id)
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.status).toBe('dead_letter')
    expect(attempts[0]?.error).toContain('purged by the retention policy')
  })
})

describe('surfaces degrade gracefully (FR-SUB-2 / FR-SUB-4)', () => {
  it('shows a tombstone in the inbox instead of a blank row', async () => {
    const f = await createForm({ retentionDays: 0 })
    const [owner] = await db
      .select({ ownerId: formTable.ownerId })
      .from(formTable)
      .where(eq(formTable.id, f.id))
    const dest = await addDestination(f.id)
    const sub = await insertSubmission(f.id, { createdAt: MINUTES_AGO_5() })
    await enqueueDeliveries(sub.id, [dest.id])
    await runWorkerOnce(succeed)
    await runZeroRetentionPassOnce()

    const inbox = await listSubmissionsForForm(owner!.ownerId, f.id)
    expect(inbox).not.toBeNull()
    expect(inbox?.retentionDays).toBe(0)
    expect(inbox?.submissions).toHaveLength(1)
    expect(inbox?.submissions[0]?.purgedAt).not.toBeNull()
    expect(inbox?.submissions[0]?.normalizedPayload).toEqual({})
    // The delivery record is still there — that is the point of a tombstone.
    expect(inbox?.submissions[0]?.deliveryStatus).toBe('delivered')
  })

  it('reports the retention policy for a form with nothing stored', async () => {
    const f = await createForm({ retentionDays: 0 })
    const [owner] = await db
      .select({ ownerId: formTable.ownerId })
      .from(formTable)
      .where(eq(formTable.id, f.id))

    const inbox = await listSubmissionsForForm(owner!.ownerId, f.id)
    expect(inbox).toEqual({ retentionDays: 0, submissions: [] })
  })
})

describe('redactSubmissions (reusable tombstone)', () => {
  it('redacts only the rows it is given, and reports how many it changed', async () => {
    const f = await createForm({ retentionDays: 0 })
    const target = await insertSubmission(f.id)
    const bystander = await insertSubmission(f.id)

    expect(await redactSubmissions([target.id])).toBe(1)
    expect((await submissionRow(target.id))?.purgedAt).not.toBeNull()
    expect((await submissionRow(bystander.id))?.purgedAt).toBeNull()

    // Already a tombstone — nothing further to redact.
    expect(await redactSubmissions([target.id])).toBe(0)
    expect(await redactSubmissions([])).toBe(0)
  })
})
