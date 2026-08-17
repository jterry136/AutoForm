import { type } from 'arktype'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { db } from '~/db'
import { deliveryAttempt, form, formDefinition, submission } from '~/db/schema'
import type { JsonObject } from '~/lib/json'
import { formDefinitionSchema, type FormDefinition } from '~/lib/validation'

/**
 * Per-form submission inbox (FR-SUB-2) with delivery visibility (NFR-OBS-1), and
 * the ownership-scoped read behind submission export (FR-SUB-4).
 *
 * Delivery state per (submission × destination) is the *latest* attempt row
 * (max attempt — D-006). Each submission gets a rolled-up `deliveryStatus`:
 *   delivered | pending | failed | partial | none (no destinations).
 *
 * Ownership is the authorization boundary (D-008): every read takes the session
 * `userId` and returns `null` — never a distinguishable "forbidden" — when the
 * form is not the caller's, so the dashboard is not an existence oracle.
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

/**
 * Hard ceiling on the rows a single export may load (FR-SUB-4). The export is
 * built in memory — serializing to a string is what makes the CSV rules
 * unit-testable — so the row count has to be bounded rather than open-ended. A
 * form past the cap exports its **most recent** `EXPORT_ROW_LIMIT` submissions
 * and says so, instead of streaming an unbounded result set through the server.
 * Documented in `docs/getting-started.md`.
 */
export const EXPORT_ROW_LIMIT = 10_000

export interface FormExport {
  formName: string
  /** The form's definition, used for column order (P-1). */
  definition: FormDefinition
  /** Newest first, capped at the requested limit. */
  submissions: SubmissionWithDelivery[]
  /** True when the form holds more submissions than the cap allowed. */
  truncated: boolean
  limit: number
}

/**
 * A definition standing in for one that is missing or no longer parses. Columns
 * then derive purely from the submitted payload keys, so an export still works
 * for a legacy form rather than failing the download.
 */
const NO_DEFINED_FIELDS: FormDefinition = { version: 1, fields: [] }

function rollUp(statuses: AttemptRow['status'][]): DeliverySummary {
  if (statuses.length === 0) return 'none'
  const allSucceeded = statuses.every((s) => s === 'succeeded')
  if (allSucceeded) return 'delivered'
  const anyDead = statuses.some((s) => s === 'dead_letter')
  const anySucceeded = statuses.some((s) => s === 'succeeded')
  if (anyDead) return anySucceeded ? 'partial' : 'failed'
  return 'pending' // pending / processing / failed-with-retry-scheduled
}

/** Newest-first submissions for a form, each with its rolled-up delivery state. */
async function loadSubmissionsWithDelivery(
  formId: string,
  limit: number,
): Promise<SubmissionWithDelivery[]> {
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

/** The owning form row, or null when the form is missing or someone else's. */
async function ownedForm(
  userId: string,
  formId: string,
): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: form.id, name: form.name })
    .from(form)
    .where(and(eq(form.id, formId), eq(form.ownerId, userId)))
  return row ?? null
}

export async function listSubmissionsForForm(
  userId: string,
  formId: string,
  limit = 100,
): Promise<SubmissionWithDelivery[] | null> {
  if (!(await ownedForm(userId, formId))) return null
  return loadSubmissionsWithDelivery(formId, limit)
}

/**
 * Everything an export needs for one form: the definition (column order), the
 * submissions (up to `limit`), and whether the cap cut the result short.
 * Returns `null` for a form the user does not own — the same result a stranger
 * gets for a form that does not exist.
 *
 * Nothing here touches `destination`, so no config or credential can reach an
 * export (P-2).
 */
export async function loadFormExport(
  userId: string,
  formId: string,
  limit = EXPORT_ROW_LIMIT,
): Promise<FormExport | null> {
  const owned = await ownedForm(userId, formId)
  if (!owned) return null

  // One extra row is enough to tell "exactly at the cap" from "more than the
  // cap", without a second count query.
  const rows = await loadSubmissionsWithDelivery(formId, limit + 1)
  const truncated = rows.length > limit

  const [defRow] = await db
    .select({ definition: formDefinition.definition })
    .from(formDefinition)
    .where(eq(formDefinition.formId, formId))
  const parsed = defRow ? formDefinitionSchema(defRow.definition) : undefined

  return {
    formName: owned.name,
    definition:
      parsed && !(parsed instanceof type.errors) ? parsed : NO_DEFINED_FIELDS,
    submissions: truncated ? rows.slice(0, limit) : rows,
    truncated,
    limit,
  }
}
