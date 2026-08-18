import { clearInterval, setInterval } from 'node:timers'
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { db } from '~/db'
import { deliveryAttempt, form, submission } from '~/db/schema'
import { env } from '~/lib/env'
import { redactSubmissions } from '~/lib/purge'

/**
 * Age-based retention purge pass (FR-SUB-3, NFR-PRIV-1, D-011).
 *
 * Purges submissions that have outlived their form's retention window. It runs
 * on an interval in the same process as the delivery worker (D-006): AutoForm has
 * no external scheduler, and a purge pass is the same shape of work as the
 * delivery poller — cheap, idempotent, and safe to skip a beat.
 *
 * This is the positive-window half of retention. The `retentionDays = 0`
 * (zero-retention) half is a separate pass in `~/lib/purge`, triggered by
 * delivery reaching a terminal state rather than by age. Both share one
 * mechanism: `redactSubmissions`.
 *
 * Semantics implemented here:
 * - `form.retentionDays = null` → **retain indefinitely**; those forms are never
 *   scanned, so a form that opted out of a window loses nothing.
 * - `form.retentionDays = N` (N > 0) → a submission is expired once it is older
 *   than N days. Non-positive values are ignored rather than treated as
 *   "purge everything" — zero-retention is the distinct mode settled by Q-3.
 * - A submission with a `pending` or `processing` delivery attempt is **held
 *   back** until delivery reaches a terminal state, so the purge can never race
 *   the worker and destroy a submission mid-flight (P-5). It is picked up by the
 *   next pass.
 *
 * **Purging is redaction to a tombstone, not `DELETE`** (D-011 §3): the content
 * columns are cleared and `purged_at` stamped, while the `submission` row and its
 * `delivery_attempt` rows survive, so "12 received, 3 dead-lettered" stays
 * reconstructable (NFR-OBS-1) while no personal data is held. Deleting rows
 * outright is the tool for deletion-on-request (NFR-PRIV-2), a different job.
 * Already-purged rows are skipped, so a tombstone is never re-scanned forever.
 *
 * Server-only: it imports the DB client, which carries secrets. All DB access is
 * through Drizzle; no raw SQL. The client-safe retention vocabulary (the three
 * states, their bounds and UI copy) lives in `~/lib/retention`, which stays free
 * of database imports.
 */

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Default gap between purge passes; overridden by RETENTION_PURGE_INTERVAL_MS. */
const DEFAULT_PURGE_INTERVAL_MS = 60 * 60_000
/** Never poll faster than this, however the env var is set. */
const MIN_PURGE_INTERVAL_MS = 60_000
/** Forms fetched per page while scanning for configured retention windows. */
const FORM_PAGE_SIZE = 200
/** Submissions considered per purge batch. */
const BATCH_SIZE = 200
/**
 * Batches per form per pass. Bounds the work one pass can do so a large backlog
 * is drained over several passes instead of one very long transaction storm.
 */
const MAX_BATCHES_PER_FORM = 25

const MS_PER_DAY = 24 * 60 * 60_000

/** Delivery states that mean "still in flight" — such rows pin their submission. */
const IN_FLIGHT_STATUSES = ['pending', 'processing'] as const

/** Configured purge interval, clamped to the floor. Exported for the worker. */
export function purgeIntervalMs(): number {
  const configured = env.RETENTION_PURGE_INTERVAL_MS
  if (!configured) return DEFAULT_PURGE_INTERVAL_MS
  return Math.max(MIN_PURGE_INTERVAL_MS, Number(configured))
}

// ─── One pass ────────────────────────────────────────────────────────────────

export interface RetentionPassSummary {
  /** Forms with a positive retention window that were examined. */
  formsScanned: number
  /** Submissions redacted to tombstones across all forms. */
  purged: number
  /** Expired submissions left intact because a delivery was still in flight. */
  heldBack: number
  durationMs: number
}

export interface RetentionPassOptions {
  batchSize?: number
  maxBatchesPerForm?: number
  /** Injectable clock; tests use it to place the cutoff deterministically. */
  now?: Date
}

interface RetentionForm {
  id: string
  retentionDays: number
}

/**
 * Page through the forms that have a positive retention window. Keyset pagination
 * on the primary key keeps each query bounded and stable across pages even while
 * forms are being created.
 */
async function* formsWithRetention(
  pageSize: number,
): AsyncGenerator<RetentionForm> {
  let cursor: string | null = null

  for (;;) {
    const page = await db
      .select({ id: form.id, retentionDays: form.retentionDays })
      .from(form)
      .where(
        and(
          isNotNull(form.retentionDays),
          gt(form.retentionDays, 0),
          cursor ? gt(form.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(form.id))
      .limit(pageSize)

    if (page.length === 0) return

    let lastId: string | null = cursor
    for (const row of page) {
      lastId = row.id
      // The WHERE clause guarantees this, but narrow the nullable column.
      if (row.retentionDays == null) continue
      yield { id: row.id, retentionDays: row.retentionDays }
    }

    if (page.length < pageSize) return
    cursor = lastId
  }
}

/** Ids of the given submissions that still have a pending/processing delivery. */
async function inFlightSubmissionIds(
  submissionIds: string[],
): Promise<Set<string>> {
  if (submissionIds.length === 0) return new Set()

  const rows = await db
    .selectDistinct({ submissionId: deliveryAttempt.submissionId })
    .from(deliveryAttempt)
    .where(
      and(
        inArray(deliveryAttempt.submissionId, submissionIds),
        inArray(deliveryAttempt.status, [...IN_FLIGHT_STATUSES]),
      ),
    )

  return new Set(rows.map((r) => r.submissionId))
}

/**
 * Purge expired submissions for one form, in bounded batches.
 *
 * Each batch re-queries the oldest expired rows that are **not already
 * tombstones** rather than paging forward, so concurrent purgers in other
 * processes simply find fewer rows to redact — a double scan is wasted work,
 * never corruption. `redactSubmissions` is guarded on `purged_at is null` and
 * reports what this process actually redacted, so two workers never double-count.
 *
 * A batch in which nothing could be purged (every candidate is held back by an
 * in-flight delivery) ends the loop for this form; the next pass retries.
 */
async function purgeForm(
  target: RetentionForm,
  cutoffFor: (retentionDays: number) => Date,
  batchSize: number,
  maxBatches: number,
  now: Date,
): Promise<{ purged: number; heldBack: number }> {
  const cutoff = cutoffFor(target.retentionDays)
  let purged = 0
  let heldBack = 0

  for (let batch = 0; batch < maxBatches; batch++) {
    const candidates = await db
      .select({ id: submission.id })
      .from(submission)
      .where(
        and(
          eq(submission.formId, target.id),
          lt(submission.createdAt, cutoff),
          // Tombstones stay in place, so they must not be re-scanned forever.
          isNull(submission.purgedAt),
        ),
      )
      .orderBy(asc(submission.createdAt))
      .limit(batchSize)

    if (candidates.length === 0) break

    const ids = candidates.map((c) => c.id)
    const inFlight = await inFlightSubmissionIds(ids)
    const purgeable = ids.filter((id) => !inFlight.has(id))
    heldBack += inFlight.size

    if (purgeable.length === 0) break

    purged += await redactSubmissions(purgeable, now)

    // A short batch means the form's backlog is drained.
    if (candidates.length < batchSize) break
  }

  return { purged, heldBack }
}

/**
 * Run one retention pass over every form with a configured window. Never throws
 * for a single bad form — a failure is logged and the pass continues, so one
 * form cannot stall retention for the whole instance.
 */
export async function runRetentionPassOnce(
  options: RetentionPassOptions = {},
): Promise<RetentionPassSummary> {
  const startedAt = Date.now()
  const now = options.now ?? new Date()
  const batchSize = options.batchSize ?? BATCH_SIZE
  const maxBatches = options.maxBatchesPerForm ?? MAX_BATCHES_PER_FORM

  const cutoffFor = (retentionDays: number) =>
    new Date(now.getTime() - retentionDays * MS_PER_DAY)

  let formsScanned = 0
  let purged = 0
  let heldBack = 0

  for await (const target of formsWithRetention(FORM_PAGE_SIZE)) {
    formsScanned++
    try {
      const result = await purgeForm(
        target,
        cutoffFor,
        batchSize,
        maxBatches,
        now,
      )
      purged += result.purged
      heldBack += result.heldBack
    } catch (err) {
      console.error(
        `[retention] purge failed for form ${target.id}:`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return { formsScanned, purged, heldBack, durationMs: Date.now() - startedAt }
}

// ─── Worker lifecycle (mirrors the delivery worker) ──────────────────────────

export interface RetentionWorkerOptions {
  intervalMs?: number
  batchSize?: number
  maxBatchesPerForm?: number
}

let purgeTimer: ReturnType<typeof setInterval> | null = null
let purging = false

/**
 * Start the periodic purge pass. Idempotent — a second call while running is a
 * no-op and returns false. Call once per server process at boot.
 */
export function startRetentionWorker(
  options: RetentionWorkerOptions = {},
): boolean {
  if (purgeTimer) return false

  const intervalMs = options.intervalMs ?? purgeIntervalMs()

  const tick = async () => {
    if (purging) return // never overlap passes
    purging = true
    try {
      const summary = await runRetentionPassOnce({
        batchSize: options.batchSize,
        maxBatchesPerForm: options.maxBatchesPerForm,
      })
      // Per-run summary for NFR-OBS-1. Logged even when nothing was purged, so
      // "retention is running" is observable.
      console.log(
        `[retention] pass complete: forms=${summary.formsScanned} ` +
          `purged=${summary.purged} heldBack=${summary.heldBack} ` +
          `in ${summary.durationMs}ms`,
      )
    } catch (err) {
      console.error(
        '[retention] pass failed:',
        err instanceof Error ? err.message : String(err),
      )
    } finally {
      purging = false
    }
  }

  purgeTimer = setInterval(tick, intervalMs)
  // Don't keep the process alive solely for the purge pass.
  purgeTimer.unref()
  void tick()

  console.log(`[retention] started (every ${intervalMs}ms)`)
  return true
}

/** Stop the periodic purge pass (e.g. on graceful shutdown). */
export function stopRetentionWorker(): void {
  if (purgeTimer) {
    clearInterval(purgeTimer)
    purgeTimer = null
  }
}
