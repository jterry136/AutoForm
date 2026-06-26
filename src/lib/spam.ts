/**
 * Spam & abuse protection (FR-SPAM-1/2): honeypot detection and an in-process,
 * fixed-window rate limiter.
 *
 * The limiter is process-local — no Redis/DB, fitting the MVP (C-1/C-3). It is
 * sufficient for a single instance; sharing limits across horizontally-scaled
 * instances is future work (NFR-SCALE). See DECISIONS.md D-009.
 */

export interface RateLimitResult {
  allowed: boolean
  retryAfterSec: number
}

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const MAX_TRACKED_KEYS = 50_000

/** True when the honeypot field carries any non-empty value (a bot filled it). */
export function isHoneypotTripped(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((v) => String(v).trim() !== '')
  if (value === undefined || value === null) return false
  return String(value).trim() !== ''
}

/** Drop expired buckets if the map grows large, to bound memory. */
function sweep(now: number): void {
  if (buckets.size <= MAX_TRACKED_KEYS) return
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

/** Allow up to `limit` calls per `windowMs` for `key` (fixed window). */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs = 60_000,
): RateLimitResult {
  const now = Date.now()
  const bucket = buckets.get(key)

  if (!bucket || bucket.resetAt <= now) {
    sweep(now)
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterSec: 0 }
  }

  if (bucket.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    }
  }

  bucket.count += 1
  return { allowed: true, retryAfterSec: 0 }
}

/** Clear all counters (test helper). */
export function resetRateLimits(): void {
  buckets.clear()
}
