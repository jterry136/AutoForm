import { eq } from 'drizzle-orm'
import { Resend } from 'resend'
import { env } from '~/lib/env'
import { escapeHtml, sanitizeHeaderValue } from '~/lib/mail-text'

/**
 * The **system mailer**: AutoForm's own transactional mail (FR-NOTIF-1).
 *
 * This is deliberately *not* the email connector (`src/connectors/email.ts`).
 * That connector is a user-configured **destination** — it delivers submissions
 * wherever a form owner points it, is registered in the connector registry, and
 * is driven by the delivery queue. Platform mail is the opposite: AutoForm
 * chooses the recipient (the form's owner), the content, and when to send.
 * Routing platform mail through the connector registry would make AutoForm a
 * destination of itself and put operational mail behind a user-editable config.
 * The two share only the low-level text primitives in `~/lib/mail-text`.
 *
 * Server-only — it imports the DB client and the Resend key (P-2).
 *
 * **Safety (NFR-SEC-3).** Two rules hold here:
 *  1. Header-bound values (recipient, subject) go through `sanitizeHeaderValue`,
 *     so a form or destination named with an embedded CRLF cannot inject a
 *     header.
 *  2. No submission payload is ever mailed. {@link DeliveryHealthAlert} has no
 *     field that can carry one — the guarantee is structural, not a convention.
 *     The connector error text it *does* carry is escaped and truncated, since a
 *     destination's error response is attacker-influenced too.
 *
 * **Degradation.** With `RESEND_API_KEY` unset the app must still boot and
 * deliver submissions; notifications simply become a logged no-op. Nothing here
 * throws — every entry point returns a structured {@link MailResult} so the
 * worker can never be stalled by a failed notification (NFR-REL-2/3).
 */

// Lazily imported so this module can be loaded (and unit-tested) without a DB.
type DbModule = typeof import('~/db')
type SchemaModule = typeof import('~/db/schema')

/** Sender identity for platform mail. Overridable for self-hosters. */
const DEFAULT_FROM = 'AutoForm <onboarding@resend.dev>'

/** Cap on the connector error text quoted back to the owner. */
const ERROR_EXCERPT_LIMIT = 400

// ─── Types ───────────────────────────────────────────────────────────────────

/** A composed platform email, ready to hand to the provider. */
export interface SystemEmail {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Outcome of a send. `skipped` marks the deliberate no-ops (no API key, no
 * resolvable recipient) so callers can tell "not configured" from "failed".
 */
export type MailResult =
  | { ok: true; id?: string }
  | { ok: false; skipped?: boolean; error: string }

/** Injection point for tests — the real one is {@link sendSystemEmail}. */
export type SystemMailSender = (message: SystemEmail) => Promise<MailResult>

/**
 * The delivery-health signal this module consumes. Produced by the detection
 * pass (threshold + de-duplication) at the point a delivery is dead-lettered;
 * this module only turns a signal into mail.
 *
 * Note what is absent: there is no submission, payload, or raw-body field. A
 * delivery-health alert describes a *destination*, never the data that was
 * being delivered.
 */
export interface DeliveryHealthAlert {
  /** Internal form id — used for the dashboard deep link, not the public id. */
  formId: string
  formName: string
  destinationId: string
  destinationName: string
  /** Connector key, e.g. 'webhook' | 'email'. */
  destinationType: string
  /** How many deliveries dead-lettered in the window that tripped the alert. */
  failureCount: number
  /** Error text from the most recent dead-letter, if any. Never a payload. */
  lastError?: string | null
  lastFailedAt?: Date | null
}

/** The account the alert belongs to, resolved server-side. */
export interface OwnerRecipient {
  email: string
  name?: string | null
}

export interface NotifyDeps {
  /** Provider call. Defaults to Resend via {@link sendSystemEmail}. */
  send?: SystemMailSender
  /** Owner lookup. Defaults to {@link resolveFormOwner} (hits the DB). */
  resolveOwner?: (formId: string) => Promise<OwnerRecipient | null>
}

// ─── Composition (pure) ──────────────────────────────────────────────────────

/** Absolute URL of a form's dashboard page, for the "fix it" link. */
export function formDashboardUrl(formId: string, baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/dashboard/forms/${encodeURIComponent(formId)}`
}

function excerpt(value: string): string {
  const collapsed = sanitizeHeaderValue(value)
  return collapsed.length > ERROR_EXCERPT_LIMIT
    ? `${collapsed.slice(0, ERROR_EXCERPT_LIMIT)}…`
    : collapsed
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/**
 * Render the delivery-failure notification. Pure — no env, no IO — so the
 * escaping rules are testable in isolation.
 */
export function renderDeliveryFailureEmail(
  alert: DeliveryHealthAlert,
  dashboardUrl: string,
): Omit<SystemEmail, 'to'> {
  const subject = sanitizeHeaderValue(
    `AutoForm: deliveries to "${alert.destinationName}" are failing`,
  )

  const failed = plural(alert.failureCount, 'delivery')
  const when = alert.lastFailedAt
    ? alert.lastFailedAt.toISOString()
    : 'recently'
  const reason = alert.lastError ? excerpt(alert.lastError) : null

  const lines = [
    `Deliveries from your form "${alert.formName}" are failing.`,
    '',
    `Destination: ${alert.destinationName} (${alert.destinationType})`,
    `Failed deliveries: ${failed}`,
    `Last failure: ${when}`,
    ...(reason ? [`Last error: ${reason}`] : []),
    '',
    'AutoForm retries each delivery with backoff before giving up. Deliveries',
    'that have already been given up on are not retried automatically.',
    '',
    `Fix or disable this destination: ${dashboardUrl}`,
    '',
    'You are receiving this because you own this form. Disabling the',
    'destination stops these emails.',
  ]

  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 8px;font-weight:600">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 8px">${escapeHtml(value)}</td></tr>`

  const html = [
    `<p>Deliveries from your form <strong>${escapeHtml(alert.formName)}</strong> are failing.</p>`,
    '<table style="border-collapse:collapse">',
    row('Destination', `${alert.destinationName} (${alert.destinationType})`),
    row('Failed deliveries', failed),
    row('Last failure', when),
    ...(reason ? [row('Last error', reason)] : []),
    '</table>',
    '<p>AutoForm retries each delivery with backoff before giving up. Deliveries ' +
      'that have already been given up on are not retried automatically.</p>',
    `<p><a href="${escapeHtml(dashboardUrl)}">Fix or disable this destination</a></p>`,
    '<p style="color:#666;font-size:12px">You are receiving this because you own ' +
      'this form. Disabling the destination stops these emails.</p>',
  ].join('')

  return { subject, text: lines.join('\n'), html }
}

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * Send one platform email via Resend. Returns a skipped result (never throws)
 * when the key is unset or the provider rejects the call.
 */
export const sendSystemEmail: SystemMailSender = async (message) => {
  const apiKey = env.RESEND_API_KEY
  if (!apiKey) {
    console.warn(
      '[mailer] RESEND_API_KEY is not configured — skipping platform email.',
    )
    return { ok: false, skipped: true, error: 'RESEND_API_KEY is not set.' }
  }

  const to = sanitizeHeaderValue(message.to)
  if (!to) {
    return { ok: false, skipped: true, error: 'No recipient address.' }
  }

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from: sanitizeHeaderValue(env.MAIL_FROM ?? DEFAULT_FROM),
      to: [to],
      subject: sanitizeHeaderValue(message.subject),
      text: message.text,
      html: message.html,
    })
    if (error) {
      return {
        ok: false,
        error: `Resend error (${error.name}): ${error.message}`,
      }
    }
    return { ok: true, id: data?.id }
  } catch (err) {
    return {
      ok: false,
      error: `Resend request failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ─── Recipient resolution (server-side only) ─────────────────────────────────

/**
 * Resolve a form's owning account email. Ownership is read from the DB, never
 * taken from a caller — the notification recipient is not something a request
 * gets to choose (P-2, D-008).
 */
export async function resolveFormOwner(
  formId: string,
): Promise<OwnerRecipient | null> {
  const { db }: DbModule = await import('~/db')
  const { form, user }: SchemaModule = await import('~/db/schema')

  const [row] = await db
    .select({ email: user.email, name: user.name })
    .from(form)
    .innerJoin(user, eq(form.ownerId, user.id))
    .where(eq(form.id, formId))
    .limit(1)

  return row ?? null
}

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Notify a form's owner that one of their destinations is failing.
 *
 * Call this from the delivery-health detection pass, which is responsible for
 * the threshold and for de-duplicating repeat alerts — this function sends
 * whatever it is handed, exactly once per call.
 *
 * Never throws: the worker must not stall or crash because mail failed.
 */
export async function notifyDeliveryFailure(
  alert: DeliveryHealthAlert,
  deps: NotifyDeps = {},
): Promise<MailResult> {
  const send = deps.send ?? sendSystemEmail
  const resolveOwner = deps.resolveOwner ?? resolveFormOwner

  try {
    const owner = await resolveOwner(alert.formId)
    if (!owner?.email) {
      console.warn(
        `[mailer] No owner email for form ${alert.formId} — skipping notification.`,
      )
      return { ok: false, skipped: true, error: 'No owner email on file.' }
    }

    const { subject, text, html } = renderDeliveryFailureEmail(
      alert,
      formDashboardUrl(alert.formId, env.BETTER_AUTH_URL),
    )
    const result = await send({ to: owner.email, subject, text, html })
    if (!result.ok && !result.skipped) {
      console.error(
        `[mailer] Failed to notify owner of form ${alert.formId}: ${result.error}`,
      )
    }
    return result
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[mailer] Notification threw and was swallowed: ${error}`)
    return { ok: false, error }
  }
}
