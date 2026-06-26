import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import { clearInterval, setInterval } from 'node:timers'
import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm'
import { db } from '~/db'
import { deliveryAttempt, destination, submission } from '~/db/schema'
import { decrypt } from '~/lib/crypto'

/**
 * Delivery queue + in-process polling worker (Chunk 3).
 *
 * The `delivery_attempt` table is both the queue and the audit log. The worker
 * loop is: reclaim stale locks → claim due `pending` rows → deliver → record the
 * result, retrying with backoff or dead-lettering (FR-DEL-1/2/4, NFR-REL-2/3,
 * NFR-OBS-1). See DECISIONS.md D-006 for the row-per-attempt model and the
 * `failed` vs `dead_letter` status semantics.
 *
 * Server-only (imports the DB client, which carries secrets). The connector that
 * performs the actual destination call is injected as a `DeliveryDispatcher` so
 * this module stays decoupled from connectors (NFR-MAINT-1); Chunk 4 supplies the
 * real one. Until then the default dispatcher dead-letters with a clear message.
 */

// ─── Tunables ────────────────────────────────────────────────────────────────

/** Max attempts per (submission × destination) before dead-lettering. */
const MAX_ATTEMPTS = 5
/** Exponential backoff base; grows 2^(attempt-1), capped, with equal jitter. */
const BACKOFF_BASE_MS = 2_000
const BACKOFF_MAX_MS = 5 * 60_000
/** How often the worker polls for due work. */
const POLL_INTERVAL_MS = 1_000
/** Rows claimed per tick. */
const BATCH_SIZE = 10
/** A `processing` row locked longer than this is presumed crashed and reclaimed. */
const STALE_LOCK_MS = 60_000
/** Cap on stored response/error bodies to keep rows small. */
const RESPONSE_BODY_LIMIT = 2_000

/** Identifies this worker process in `locked_by` (for debugging multi-worker). */
const WORKER_ID = `${hostname()}#${process.pid}#${randomBytes(3).toString('hex')}`

type DeliveryAttemptRow = typeof deliveryAttempt.$inferSelect

// ─── Connector boundary (real connectors arrive in Chunk 4) ──────────────────

/** Everything a connector needs to perform one delivery. */
export interface DeliveryContext {
  readonly attemptId: string
  readonly attempt: number
  readonly submissionId: string
  readonly destinationType: string
  readonly config: Record<string, unknown>
  /** Decrypted credential string, or null when the destination has no secret. */
  readonly credentials: string | null
  readonly payload: Record<string, unknown>
}

/** Result of a delivery: success, or a retryable / non-retryable failure. */
export type DeliveryOutcome =
  | { ok: true; responseStatus?: number; responseBody?: string }
  | {
      ok: false
      retryable: boolean
      error: string
      responseStatus?: number
      responseBody?: string
    }

export type DeliveryDispatcher = (
  context: DeliveryContext,
) => Promise<DeliveryOutcome>

/** Default until Chunk 4 wires connectors: terminal, non-retryable failure. */
const noopDispatcher: DeliveryDispatcher = async () => ({
  ok: false,
  retryable: false,
  error: 'No delivery connector is configured (connectors land in Chunk 4).',
})

// ─── Enqueue (Chunk 2) ───────────────────────────────────────────────────────

/**
 * Enqueue one `pending` attempt per destination. A single INSERT keeps the
 * ingestion path fast (P-3); column defaults supply status='pending', attempt=1,
 * and next_run_at=now().
 */
export async function enqueueDeliveries(
  submissionId: string,
  destinationIds: string[],
): Promise<void> {
  if (destinationIds.length === 0) return

  await db
    .insert(deliveryAttempt)
    .values(
      destinationIds.map((destinationId) => ({ submissionId, destinationId })),
    )
}

// ─── Backoff (pure) ──────────────────────────────────────────────────────────

/**
 * Delay before `attempt` (the upcoming attempt number, ≥ 2 for retries):
 * exponential `base · 2^(attempt-1)`, capped, with equal jitter (half fixed,
 * half random) to avoid a thundering herd.
 */
export function computeBackoffMs(attempt: number): number {
  const exponent = Math.max(0, attempt - 1)
  const capped = Math.min(BACKOFF_BASE_MS * 2 ** exponent, BACKOFF_MAX_MS)
  const half = capped / 2
  return Math.floor(half + Math.random() * half)
}

// ─── Worker internals ────────────────────────────────────────────────────────

function truncate(value: string | null | undefined): string | null {
  if (value == null) return null
  return value.length > RESPONSE_BODY_LIMIT
    ? value.slice(0, RESPONSE_BODY_LIMIT)
    : value
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Return `processing` rows whose lock has gone stale (a worker crashed mid-flight)
 * to `pending` so they are retried — no submission is lost (NFR-REL-3). The same
 * attempt number is preserved; the interrupted try doesn't count as a failure.
 */
export async function reclaimStaleAttempts(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS)
  const reclaimed = await db
    .update(deliveryAttempt)
    .set({ status: 'pending', lockedAt: null, lockedBy: null, startedAt: null })
    .where(
      and(
        eq(deliveryAttempt.status, 'processing'),
        lt(deliveryAttempt.lockedAt, cutoff),
      ),
    )
    .returning({ id: deliveryAttempt.id })
  return reclaimed.length
}

/**
 * Atomically claim up to `limit` due attempts. `SELECT … FOR UPDATE SKIP LOCKED`
 * inside a transaction lets multiple workers pull disjoint batches without
 * blocking each other; the rows are flipped to `processing` and stamped with this
 * worker's lock before the transaction commits.
 */
async function claimDueAttempts(limit: number): Promise<DeliveryAttemptRow[]> {
  const now = new Date()
  return db.transaction(async (tx) => {
    const due = await tx
      .select({ id: deliveryAttempt.id })
      .from(deliveryAttempt)
      .where(
        and(
          eq(deliveryAttempt.status, 'pending'),
          lte(deliveryAttempt.nextRunAt, now),
        ),
      )
      .orderBy(asc(deliveryAttempt.nextRunAt))
      .limit(limit)
      .for('update', { skipLocked: true })

    if (due.length === 0) return []

    return tx
      .update(deliveryAttempt)
      .set({
        status: 'processing',
        lockedAt: now,
        lockedBy: WORKER_ID,
        startedAt: now,
      })
      .where(
        inArray(
          deliveryAttempt.id,
          due.map((d) => d.id),
        ),
      )
      .returning()
  })
}

/**
 * Load the submission + destination for a claimed attempt and decrypt the
 * destination's credentials (P-2: decrypt only at delivery time). Returns null
 * if the submission or destination no longer exists.
 */
async function buildContext(
  row: DeliveryAttemptRow,
): Promise<DeliveryContext | null> {
  const [dest] = await db
    .select()
    .from(destination)
    .where(eq(destination.id, row.destinationId))
  if (!dest) return null

  const [sub] = await db
    .select()
    .from(submission)
    .where(eq(submission.id, row.submissionId))
  if (!sub) return null

  return {
    attemptId: row.id,
    attempt: row.attempt,
    submissionId: sub.id,
    destinationType: dest.type,
    config: dest.config,
    credentials: dest.encryptedCredentials
      ? decrypt(dest.encryptedCredentials)
      : null,
    payload: sub.normalizedPayload,
  }
}

/**
 * Record the result of an attempt. Success → `succeeded`. Failure → `dead_letter`
 * when non-retryable or out of attempts, otherwise `failed` plus a fresh `pending`
 * row for the next attempt (so `failed` always has a successor; `dead_letter` is
 * terminal — D-006).
 */
async function finalize(
  row: DeliveryAttemptRow,
  outcome: DeliveryOutcome,
): Promise<void> {
  if (outcome.ok) {
    await db
      .update(deliveryAttempt)
      .set({
        status: 'succeeded',
        responseStatus: outcome.responseStatus ?? null,
        responseBody: truncate(outcome.responseBody),
        error: null,
        finishedAt: new Date(),
      })
      .where(eq(deliveryAttempt.id, row.id))
    return
  }

  const terminal = !outcome.retryable || row.attempt >= MAX_ATTEMPTS

  await db.transaction(async (tx) => {
    await tx
      .update(deliveryAttempt)
      .set({
        status: terminal ? 'dead_letter' : 'failed',
        responseStatus: outcome.responseStatus ?? null,
        responseBody: truncate(outcome.responseBody),
        error: truncate(outcome.error),
        finishedAt: new Date(),
      })
      .where(eq(deliveryAttempt.id, row.id))

    if (!terminal) {
      const nextAttempt = row.attempt + 1
      await tx.insert(deliveryAttempt).values({
        submissionId: row.submissionId,
        destinationId: row.destinationId,
        attempt: nextAttempt,
        status: 'pending',
        nextRunAt: new Date(Date.now() + computeBackoffMs(nextAttempt)),
      })
    }
  })
}

/** Deliver one claimed attempt and finalize it. Never throws. */
async function processClaimed(
  row: DeliveryAttemptRow,
  dispatch: DeliveryDispatcher,
): Promise<void> {
  let context: DeliveryContext | null
  try {
    context = await buildContext(row)
  } catch (err) {
    // Decrypt/config failures are permanent — don't spin on them.
    await finalize(row, {
      ok: false,
      retryable: false,
      error: `Failed to prepare delivery: ${errorMessage(err)}`,
    })
    return
  }

  if (!context) {
    await finalize(row, {
      ok: false,
      retryable: false,
      error: 'Submission or destination no longer exists.',
    })
    return
  }

  let outcome: DeliveryOutcome
  try {
    outcome = await dispatch(context)
  } catch (err) {
    // An unexpected throw from a connector is treated as transient.
    outcome = { ok: false, retryable: true, error: errorMessage(err) }
  }

  await finalize(row, outcome)
}

/**
 * One worker tick: reclaim stale locks, claim a batch, deliver them concurrently.
 * Returns how many attempts were processed. Exposed for tests/manual draining.
 */
export async function runWorkerOnce(
  dispatch: DeliveryDispatcher = noopDispatcher,
  batchSize: number = BATCH_SIZE,
): Promise<number> {
  await reclaimStaleAttempts()
  const claimed = await claimDueAttempts(batchSize)
  await Promise.all(claimed.map((row) => processClaimed(row, dispatch)))
  return claimed.length
}

// ─── Worker lifecycle ────────────────────────────────────────────────────────

export interface WorkerOptions {
  /** Connector dispatcher; defaults to the dead-lettering placeholder. */
  dispatch?: DeliveryDispatcher
  intervalMs?: number
  batchSize?: number
}

let pollTimer: ReturnType<typeof setInterval> | null = null
let ticking = false

/**
 * Start the polling worker. Idempotent — a second call while running is a no-op
 * and returns false. Call once per server process at boot.
 */
export function startDeliveryWorker(options: WorkerOptions = {}): boolean {
  if (pollTimer) return false

  const dispatch = options.dispatch ?? noopDispatcher
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS
  const batchSize = options.batchSize ?? BATCH_SIZE

  const tick = async () => {
    if (ticking) return // never overlap ticks
    ticking = true
    try {
      await runWorkerOnce(dispatch, batchSize)
    } catch (err) {
      console.error('[delivery-worker] tick failed:', errorMessage(err))
    } finally {
      ticking = false
    }
  }

  pollTimer = setInterval(tick, intervalMs)
  // Don't keep the process alive solely for the poller.
  pollTimer.unref()
  void tick()

  console.log(
    `[delivery-worker] started (worker=${WORKER_ID}, every ${intervalMs}ms)`,
  )
  return true
}

/** Stop the polling worker (e.g. on graceful shutdown). */
export function stopDeliveryWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
