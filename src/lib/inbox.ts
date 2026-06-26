import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { deliveryAttempt, form, submission } from '~/db/schema'
import type { JsonObject } from '~/lib/json'

/**
 * Per-form submission inbox (FR-SUB-2) with delivery visibility (NFR-OBS-1).
 *
 * Delivery state per (submission × destination) is the *latest* attempt row
 * (max attempt — D-006). Each submission gets a rolled-up `deliveryStatus`:
 *   delivered | pending | failed | partial | none (no destinations).
 */

export type DeliverySummary =
  | 'delivered'
  | 'pending'
  | 'failed'
  | 'partial'
  | 'none'

type AttemptRow = typeof deliveryAttempt.$inferSelect

export interface SubmissionWithDelivery {
  id: string
  createdAt: Date
  normalizedPayload: JsonObject
  deliveryStatus: DeliverySummary
  deliveries: Array<{
    destinationId: string
    status: AttemptRow['status']
    attempt: number
    error: string | null
    responseStatus: number | null
  }>
}

function rollUp(statuses: AttemptRow['status'][]): DeliverySummary {
  if (statuses.length === 0) return 'none'
  const allSucceeded = statuses.every((s) => s === 'succeeded')
  if (allSucceeded) return 'delivered'
  const anyDead = statuses.some((s) => s === 'dead_letter')
  const anySucceeded = statuses.some((s) => s === 'succeeded')
  if (anyDead) return anySucceeded ? 'partial' : 'failed'
  return 'pending' // pending / processing / failed-with-retry-scheduled
}

export async function listSubmissionsForForm(
  userId: string,
  formId: string,
  limit = 100,
): Promise<SubmissionWithDelivery[] | null> {
  const owned = await db
    .select({ id: form.id })
    .from(form)
    .where(and(eq(form.id, formId), eq(form.ownerId, userId)))
  if (!owned.length) return null

  const subs = await db
    .select()
    .from(submission)
    .where(eq(submission.formId, formId))
    .orderBy(desc(submission.createdAt))
    .limit(limit)
  if (subs.length === 0) return []

  const attempts = await db
    .select()
    .from(deliveryAttempt)
    .where(
      inArray(
        deliveryAttempt.submissionId,
        subs.map((s) => s.id),
      ),
    )

  // Reduce to the latest attempt per (submission, destination).
  const latest = new Map<string, AttemptRow>()
  for (const a of attempts) {
    const key = `${a.submissionId}|${a.destinationId}`
    const prev = latest.get(key)
    if (!prev || a.attempt > prev.attempt) latest.set(key, a)
  }

  const bySubmission = new Map<string, AttemptRow[]>()
  for (const a of latest.values()) {
    const list = bySubmission.get(a.submissionId) ?? []
    list.push(a)
    bySubmission.set(a.submissionId, list)
  }

  return subs.map((s) => {
    const rows = bySubmission.get(s.id) ?? []
    return {
      id: s.id,
      createdAt: s.createdAt,
      normalizedPayload: s.normalizedPayload as JsonObject,
      deliveryStatus: rollUp(rows.map((r) => r.status)),
      deliveries: rows.map((r) => ({
        destinationId: r.destinationId,
        status: r.status,
        attempt: r.attempt,
        error: r.error,
        responseStatus: r.responseStatus,
      })),
    }
  })
}
