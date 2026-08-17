import { type } from 'arktype'

/**
 * Per-form retention policy (FR-SUB-3, NFR-PRIV-1, D-011).
 *
 * One nullable integer carries all three states, so there is no second column to
 * keep in sync with it:
 *
 * - `null` → retain indefinitely
 * - `0`    → zero-retention (purged as soon as delivery is terminal)
 * - `1…3650` → keep that many days
 *
 * This module is deliberately free of database and environment imports: the
 * dashboard route needs the same vocabulary the server enforces (P-1 — derive,
 * never duplicate), and a client module must not pull in `~/db`.
 *
 * The purge pass that acts on these values is a separate concern (D-011 §5).
 */

/** Ten years. A bound stops a typo (`36500`) becoming a policy nobody meant. */
export const MAX_RETENTION_DAYS = 3650

/** Applied to newly created forms; existing forms are never backfilled (D-011 §1). */
export const DEFAULT_RETENTION_DAYS = 90

export type RetentionMode = 'indefinite' | 'days' | 'zero'

export const retentionDaysSchema = type('number | null')
  .narrow((value, ctx) => {
    if (value === null) return true
    if (!Number.isInteger(value)) return ctx.mustBe('a whole number of days')
    if (value < 0 || value > MAX_RETENTION_DAYS) {
      return ctx.mustBe(`between 0 and ${MAX_RETENTION_DAYS} days`)
    }
    return true
  })
  .describe('a retention policy')

/** Which of the three states a stored value represents. */
export function retentionMode(retentionDays: number | null): RetentionMode {
  if (retentionDays === null) return 'indefinite'
  return retentionDays === 0 ? 'zero' : 'days'
}

/**
 * Whether moving from `current` to `next` needs an explicit confirmation.
 *
 * Retention is a property of the data, not of when the policy was set (D-011 §4):
 * shortening a window applies retroactively on the next purge pass, so a
 * reduction — and any move to zero-retention — destroys stored submissions that
 * are outside the new window. Lengthening or keeping the window does not.
 */
export function retentionNeedsConfirmation(
  current: number | null,
  next: number | null,
): boolean {
  if (next === null) return false // indefinite keeps everything
  if (next === 0) return current !== 0 // zero-retention is destructive going forward
  if (current === null) return true // indefinite → bounded loses older data
  return next < current
}

/** Short human description of a policy, for UI copy. */
export function describeRetention(retentionDays: number | null): string {
  switch (retentionMode(retentionDays)) {
    case 'indefinite':
      return 'Submissions are kept until you delete them.'
    case 'zero':
      return 'Submissions are purged as soon as delivery finishes.'
    default:
      return `Submissions are kept for ${retentionDays} day${retentionDays === 1 ? '' : 's'}.`
  }
}
