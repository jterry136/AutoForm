import { eq } from 'drizzle-orm'
import { destination, destinationHealth, form } from '~/db/schema'
import type {
  DeliveryHealthNotifier,
  DeliveryHealthSignal,
} from '~/lib/delivery-health'
import type { DeliveryHealthAlert, MailResult } from '~/lib/mailer'

/**
 * The bridge between delivery-health **detection** and the **system mailer**
 * (FR-NOTIF-1, NFR-OBS-1).
 *
 * Detection (`~/lib/delivery-health`) decides *when* a destination is broken and
 * emits a `DeliveryHealthSignal` carrying nothing but a destination id and a
 * count. The mailer (`~/lib/mailer`) knows how to compose and send an owner
 * email but not who to send it to. This module is the only place that joins the
 * two: it resolves the destination's form and owner-facing names, honours the
 * per-form opt-out, and hands a {@link DeliveryHealthAlert} to the mailer.
 *
 * It is injected at the worker boundary (`WorkerOptions.notify` in
 * `~/lib/queue`) rather than imported by the queue, so the delivery core never
 * depends on a mail provider and tests can substitute a fake (D-010 §4).
 *
 * **Never throws.** A notification failure must not crash or stall the worker
 * (NFR-REL-2/3) — every path returns a {@link NotificationOutcome} instead.
 *
 * **Carries no submission content.** The alert type has no payload field, and
 * everything this module reads (form name, destination name/type, connector
 * error text) is destination metadata. A broken webhook cannot leak a
 * submission into an email.
 *
 * Server-only: the default lookup imports the DB client.
 */

// Lazily imported so the pure half of this module is unit-testable without a DB.
type DbModule = typeof import('~/db')

// ─── Lookup ──────────────────────────────────────────────────────────────────

/** Everything the alert needs that the signal itself doesn't carry. */
export interface NotificationTarget {
  formId: string
  formName: string
  destinationName: string
  destinationType: string
  /** `form.deliveryHealthEmails` — false means the owner opted out (D-013). */
  emailsEnabled: boolean
  /** Persisted timestamp of the dead-letter that produced the signal. */
  lastDeadLetterAt: Date | null
}

export type NotificationTargetLookup = (
  destinationId: string,
) => Promise<NotificationTarget | null>

/**
 * Resolve a destination to its form, owner-facing names, and opt-out flag.
 *
 * Reads the persisted health row for `lastDeadLetterAt` so the email quotes the
 * failure's own timestamp rather than the moment the mail happened to be
 * composed. The row is written and committed by `recordDeliveryOutcome` before
 * the signal reaches a notifier, so it is always current here.
 */
export const lookupNotificationTarget: NotificationTargetLookup = async (
  destinationId,
) => {
  const { db }: DbModule = await import('~/db')

  const [row] = await db
    .select({
      formId: form.id,
      formName: form.name,
      destinationName: destination.name,
      destinationType: destination.type,
      emailsEnabled: form.deliveryHealthEmails,
      lastDeadLetterAt: destinationHealth.lastDeadLetterAt,
    })
    .from(destination)
    .innerJoin(form, eq(destination.formId, form.id))
    .leftJoin(
      destinationHealth,
      eq(destinationHealth.destinationId, destination.id),
    )
    .where(eq(destination.id, destinationId))
    .limit(1)

  return row ?? null
}

// ─── Decision (pure) ─────────────────────────────────────────────────────────

/**
 * Why a signal did not produce an email. All of these are ordinary outcomes, not
 * errors — the caller logs them and moves on.
 *
 * - `recovered` — recovery is surfaced by the dashboard badge clearing, not by a
 *   second email. An owner who has just fixed a destination does not need to be
 *   told they fixed it.
 * - `opted_out` — the form's `deliveryHealthEmails` flag is off. Detection and
 *   the badge still run; only the mail is suppressed.
 * - `unknown_destination` — the destination (or its form) was deleted between
 *   the dead-letter and the notification. Nothing to report to nobody.
 */
export type SkipReason = 'recovered' | 'opted_out' | 'unknown_destination'

export type NotificationDecision =
  | { readonly action: 'send'; readonly alert: DeliveryHealthAlert }
  | { readonly action: 'skip'; readonly reason: SkipReason }

/**
 * Turn a signal + its resolved target into either an alert to send or a reason
 * not to. Pure, so the opt-out and recovery rules are testable without a DB or a
 * mail provider.
 */
export function decideNotification(
  signal: DeliveryHealthSignal,
  target: NotificationTarget | null,
): NotificationDecision {
  if (signal.kind === 'recovered') {
    return { action: 'skip', reason: 'recovered' }
  }
  if (!target) {
    return { action: 'skip', reason: 'unknown_destination' }
  }
  if (!target.emailsEnabled) {
    return { action: 'skip', reason: 'opted_out' }
  }

  return {
    action: 'send',
    alert: {
      formId: target.formId,
      formName: target.formName,
      destinationId: signal.destinationId,
      destinationName: target.destinationName,
      destinationType: target.destinationType,
      failureCount: signal.consecutiveDeadLetters,
      lastError: signal.lastError,
      lastFailedAt: target.lastDeadLetterAt ?? signal.since,
    },
  }
}

// ─── Notifier ────────────────────────────────────────────────────────────────

export type NotificationOutcome =
  | { readonly sent: true; readonly result: MailResult }
  | { readonly sent: false; readonly reason: SkipReason | 'error' }

export interface DeliveryNotifierDeps {
  /** Target resolution. Defaults to {@link lookupNotificationTarget} (hits the DB). */
  lookup?: NotificationTargetLookup
  /** Mail send. Defaults to `notifyDeliveryFailure` from `~/lib/mailer`. */
  send?: (alert: DeliveryHealthAlert) => Promise<MailResult>
}

/**
 * Handle one signal end to end and report what happened. Exposed separately from
 * {@link buildDeliveryHealthNotifier} so tests can assert on the outcome, which
 * the worker-facing notifier deliberately discards.
 */
export async function handleHealthSignal(
  signal: DeliveryHealthSignal,
  deps: DeliveryNotifierDeps = {},
): Promise<NotificationOutcome> {
  try {
    // Skip the lookup entirely for a recovery — nothing about the destination
    // changes the answer, and the worker shouldn't pay for a query to say no.
    const decision =
      signal.kind === 'recovered'
        ? decideNotification(signal, null)
        : decideNotification(
            signal,
            await (deps.lookup ?? lookupNotificationTarget)(
              signal.destinationId,
            ),
          )

    if (decision.action === 'skip') {
      logSkip(signal, decision.reason)
      return { sent: false, reason: decision.reason }
    }

    const send =
      deps.send ??
      (async (alert: DeliveryHealthAlert) => {
        const { notifyDeliveryFailure } = await import('~/lib/mailer')
        return notifyDeliveryFailure(alert)
      })

    return { sent: true, result: await send(decision.alert) }
  } catch (err) {
    console.error(
      `[delivery-notifications] notification for destination ${signal.destinationId} failed:`,
      err instanceof Error ? err.message : String(err),
    )
    return { sent: false, reason: 'error' }
  }
}

function logSkip(signal: DeliveryHealthSignal, reason: SkipReason): void {
  const where = `destination ${signal.destinationId}`
  if (reason === 'recovered') {
    console.log(`[delivery-notifications] ${where} recovered — no email sent.`)
    return
  }
  if (reason === 'opted_out') {
    console.log(
      `[delivery-notifications] ${where} is unhealthy but its form has ` +
        'delivery-health emails turned off — no email sent.',
    )
    return
  }
  console.warn(
    `[delivery-notifications] ${where} no longer exists — nothing to notify.`,
  )
}

/**
 * The production notifier, ready to hand to `startDeliveryWorker`.
 *
 * Returns a `DeliveryHealthNotifier` (a void-returning callback) so a failed
 * notification can never surface as a rejected promise inside `finalize`.
 */
export function buildDeliveryHealthNotifier(
  deps: DeliveryNotifierDeps = {},
): DeliveryHealthNotifier {
  return async (signal) => {
    await handleHealthSignal(signal, deps)
  }
}

/** Default instance used at worker boot. */
export const deliveryHealthNotifier: DeliveryHealthNotifier =
  buildDeliveryHealthNotifier()
