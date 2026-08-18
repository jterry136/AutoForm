import { clearInterval, setInterval } from 'node:timers'
import { and, asc, eq, gt, inArray, isNull, lte } from 'drizzle-orm'
import { db } from '~/db'
import { deliveryAttempt, form, submission } from '~/db/schema'

/**
 * Zero-retention purge (FR-SUB-3, NFR-PRIV-1) — the `retentionDays = 0` half of
 * the retention story. The age-based sweep for forms with a positive window is a
 * separate pass; everything below only ever looks at zero-retention forms.
 *
 * The contract comes from the Q-3 retention decision (D-011):
 *
 * - **Zero-retention is persist → deliver → purge, never "don't write".** P-5 is
 *   not negotiable: ingestion still stores the submission before any delivery is
 *   attempted. Zero-retention changes how long it lives, not whether it is
 *   written, so a crash between accepting and delivering still loses nothing.
 * - **A submission is purged once every delivery attempt for it has reached a
 *   terminal state** (`succeeded` / `dead_letter`), or at a hard ceiling of 24
 *   hours after receipt if a destination is still retrying or stuck. The ceiling
 *   is generous against the retry envelope (5 attempts, ≤5 min backoff — D-006),
 *   so it only fires when something is wrong.
 * - **Purging is redaction to a tombstone, not `DELETE`.** The content columns
 *   are cleared and `purged_at` is stamped; the `submission` row and its
 *   `delivery_attempt` rows survive, so "12 received, 3 dead-lettered" stays
 *   reconstructable (NFR-OBS-1) while no personal data is held. Deleting rows
 *   outright is the tool for deletion-on-request (NFR-PRIV-2), a different job.
 * - **The pass runs in-process beside the delivery poller** (D-006), on a slower
 *   cadence. Purging inside the delivery path would put destination-shaped work
 *   on the ingestion path, which P-3 rules out — so zero-retention content is
 *   reachable in the inbox for the few minutes between terminal delivery and the
 *   next pass. That is inherent to a polling model.
 *
 * Every read of submission content must therefore handle a tombstone:
 * `purgedAt != null` means "content is gone", which is neither "no submission"
 * nor "empty payload". The delivery worker refuses a purged submission rather
 * than shipping an empty payload; the inbox and export label it.
 *
 * Server-only — it imports the DB client, which carries secrets. All access is
 * through Drizzle; no raw SQL.
 */

// ─── Tunables ────────────────────────────────────────────────────────────────
// Constants rather than env vars, matching the queue's tunables (D-006): one
// place to change, nothing new to configure for a self-hoster.

/** Gap between passes. Slower than the delivery poller — this is a sweep. */
const PASS_INTERVAL_MS = 5 * 60_000
/** Purge even while a destination is still retrying, once a submission is this old. */
export const ZERO_RETENTION_CEILING_MS = 24 * 60 * 60_000
/**
 * Ingestion persists the submission and *then* enqueues its attempts (P-5). A
 * submission younger than this could be in that window, with its attempt rows
 * not yet written — indistinguishable from "no destinations, nothing to wait
 * for". Ignoring the newest submissions closes the race for the price of one
 * pass of latency.
 */
const ENQUEUE_GRACE_MS = 30_000
/** Submissions examined per batch. */
const BATCH_SIZE = 200
/** Batches per pass, so a large backlog is drained over several passes. */
const MAX_BATCHES_PER_PASS = 25

/** Delivery states that mean "still in flight" — such rows hold a submission. */
const IN_FLIGHT_STATUSES = ['pending', 'processing'] as const

type DeliveryStatus = (typeof deliveryAttempt.$inferSelect)['status']

// ─── Decision (pure) ─────────────────────────────────────────────────────────

export type PurgeReason = 'terminal' | 'ceiling'

export type PurgeDecision =
  | { purge: true; reason: PurgeReason }
  | { purge: false; reason: 'in_flight' }

/**
 * Whether a zero-retention submission may be purged, given the statuses of its
 * latest delivery attempts and its age.
 *
 * No attempts at all (a form with no destinations, or all of them disabled)
 * counts as terminal: there is nothing left to deliver. Callers must not pass
 * submissions young enough to still be inside the enqueue window — see
 * `ENQUEUE_GRACE_MS`.
 */
export function decidePurge(
  statuses: readonly DeliveryStatus[],
  ageMs: number,
  ceilingMs: number = ZERO_RETENTION_CEILING_MS,
): PurgeDecision {
  const inFlight = statuses.some((status) =>
    (IN_FLIGHT_STATUSES as readonly string[]).includes(status),
  )
  if (!inFlight) return { purge: true, reason: 'terminal' }
  if (ageMs >= ceilingMs) return { purge: true, reason: 'ceiling' }
  return { purge: false, reason: 'in_flight' }
}

// ─── Redaction ───────────────────────────────────────────────────────────────

/**
 * Redact the given submissions to tombstones (D-011 §3) and return how many rows
 * were actually redacted.
 *
 * Content columns are cleared and `purged_at` stamped. On the attempt rows only
 * `response_body` is cleared — a destination can echo the payload back — while
 * `status`, `attempt`, `response_status`, timings and `error` are kept, because
 * connector errors are AutoForm's own message text, not submitted content.
 *
 * Idempotent: the `purged_at is null` guard means re-running over the same ids
 * redacts nothing and reports 0, so concurrent instances duplicate work at worst.
 * Exported for reuse by other retention work.
 */
export async function redactSubmissions(
  submissionIds: readonly string[],
  now: Date = new Date(),
): Promise<number> {
  if (submissionIds.length === 0) return 0
  const ids = [...submissionIds]

  return db.transaction(async (tx) => {
    const redacted = await tx
      .update(submission)
      .set({
        rawBody: null,
        normalizedPayload: {},
        referer: null,
        clientFingerprint: null,
        userAgent: null,
        purgedAt: now,
      })
      .where(and(inArray(submission.id, ids), isNull(submission.purgedAt)))
      .returning({ id: submission.id })

    if (redacted.length === 0) return 0

    await tx
      .update(deliveryAttempt)
      .set({ responseBody: null })
      .where(
        inArray(
          deliveryAttempt.submissionId,
          redacted.map((row) => row.id),
        ),
      )

    return redacted.length
  })
}

// ─── One pass ────────────────────────────────────────────────────────────────

export interface ZeroRetentionPassSummary {
  /** Zero-retention submissions examined. */
  scanned: number
  /** Submissions redacted to tombstones. */
  purged: number
  /** Left in place because a delivery was still in flight, below the ceiling. */
  heldBack: number
  durationMs: number
}

export interface ZeroRetentionPassOptions {
  batchSize?: number
  maxBatches?: number
  /** Injectable clock; tests use it to place the grace window and the ceiling. */
  now?: Date
}

interface Candidate {
  id: string
  createdAt: Date
}

/**
 * One page of un-purged submissions on zero-retention forms, oldest ingestion
 * first within the page. Keyset pagination on the primary key keeps each query
 * bounded and, unlike an offset, cannot skip a row when held-back submissions
 * stay in the candidate set across batches.
 */
async function candidatePage(
  cutoff: Date,
  pageSize: number,
  cursor: string | null,
): Promise<Candidate[]> {
  return db
    .select({ id: submission.id, createdAt: submission.createdAt })
    .from(submission)
    .innerJoin(form, eq(form.id, submission.formId))
    .where(
      and(
        eq(form.retentionDays, 0),
        isNull(submission.purgedAt),
        lte(submission.createdAt, cutoff),
        cursor ? gt(submission.id, cursor) : undefined,
      ),
    )
    .orderBy(asc(submission.id))
    .limit(pageSize)
}

/** Latest attempt status per (submission × destination), keyed by submission. */
async function latestStatusesBySubmission(
  submissionIds: readonly string[],
): Promise<Map<string, DeliveryStatus[]>> {
  const bySubmission = new Map<string, DeliveryStatus[]>()
  if (submissionIds.length === 0) return bySubmission

  const rows = await db
    .select({
      submissionId: deliveryAttempt.submissionId,
      destinationId: deliveryAttempt.destinationId,
      attempt: deliveryAttempt.attempt,
      status: deliveryAttempt.status,
    })
    .from(deliveryAttempt)
    .where(inArray(deliveryAttempt.submissionId, [...submissionIds]))

  // Reduce to the latest attempt per (submission, destination) — the same
  // "max attempt wins" rule the inbox rollup uses (D-006).
  const latest = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    const key = `${row.submissionId}|${row.destinationId}`
    const previous = latest.get(key)
    if (!previous || row.attempt > previous.attempt) latest.set(key, row)
  }

  for (const row of latest.values()) {
    const list = bySubmission.get(row.submissionId) ?? []
    list.push(row.status)
    bySubmission.set(row.submissionId, list)
  }
  return bySubmission
}

/**
 * Run one zero-retention pass. Bounded by `maxBatches`, safe to run concurrently
 * with itself or with the delivery worker, and never throws for a submission it
 * cannot decide on — it simply holds it for the next pass.
 */
export async function runZeroRetentionPassOnce(
  options: ZeroRetentionPassOptions = {},
): Promise<ZeroRetentionPassSummary> {
  const startedAt = Date.now()
  const now = options.now ?? new Date()
  const batchSize = options.batchSize ?? BATCH_SIZE
  const maxBatches = options.maxBatches ?? MAX_BATCHES_PER_PASS
  const cutoff = new Date(now.getTime() - ENQUEUE_GRACE_MS)

  let scanned = 0
  let purged = 0
  let heldBack = 0
  let cursor: string | null = null

  for (let batch = 0; batch < maxBatches; batch++) {
    const candidates = await candidatePage(cutoff, batchSize, cursor)
    if (candidates.length === 0) break

    const statuses = await latestStatusesBySubmission(
      candidates.map((c) => c.id),
    )

    const due: string[] = []
    for (const candidate of candidates) {
      scanned += 1
      const decision = decidePurge(
        statuses.get(candidate.id) ?? [],
        now.getTime() - candidate.createdAt.getTime(),
      )
      if (decision.purge) due.push(candidate.id)
      else heldBack += 1
    }

    purged += await redactSubmissions(due, now)

    const last = candidates[candidates.length - 1]
    if (!last || candidates.length < batchSize) break
    cursor = last.id
  }

  return { scanned, purged, heldBack, durationMs: Date.now() - startedAt }
}

// ─── Pass lifecycle ──────────────────────────────────────────────────────────

export interface ZeroRetentionPurgeOptions {
  intervalMs?: number
  batchSize?: number
}

let passTimer: ReturnType<typeof setInterval> | null = null
let passing = false

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Start the zero-retention purge pass. Idempotent — a second call while running
 * is a no-op and returns false. Call once per server process at boot.
 */
export function startZeroRetentionPurge(
  options: ZeroRetentionPurgeOptions = {},
): boolean {
  if (passTimer) return false

  const intervalMs = options.intervalMs ?? PASS_INTERVAL_MS
  const batchSize = options.batchSize ?? BATCH_SIZE

  const pass = async () => {
    if (passing) return // never overlap passes
    passing = true
    try {
      const summary = await runZeroRetentionPassOnce({ batchSize })
      if (summary.purged > 0 || summary.heldBack > 0) {
        console.log(
          `[zero-retention] purged ${summary.purged}, held ${summary.heldBack} ` +
            `of ${summary.scanned} in ${summary.durationMs}ms`,
        )
      }
    } catch (err) {
      console.error('[zero-retention] pass failed:', errorMessage(err))
    } finally {
      passing = false
    }
  }

  passTimer = setInterval(pass, intervalMs)
  // Don't keep the process alive solely for the sweep.
  passTimer.unref()
  void pass()

  console.log(`[zero-retention] started (every ${intervalMs}ms)`)
  return true
}

/** Stop the purge pass (e.g. on graceful shutdown). */
export function stopZeroRetentionPurge(): void {
  if (passTimer) {
    clearInterval(passTimer)
    passTimer = null
  }
}
