import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { deliveryAttempt, destination } from '~/db/schema'
import { getDestinationHealth } from '~/lib/delivery-health'
import {
  buildDeliveryHealthNotifier,
  lookupNotificationTarget,
} from '~/lib/delivery-notifications'
import { getFormForUser, setDeliveryHealthEmailsForUser } from '~/lib/forms'
import type { DeliveryHealthAlert, MailResult } from '~/lib/mailer'
import { runWorkerOnce, type DeliveryDispatcher } from '~/lib/queue'
import { createForm, insertSubmission, resetDb } from '../../test/helpers'

/**
 * P2-4c end to end: a destination that keeps dead-lettering gets its owner
 * mailed exactly once, the dashboard shows it as failing, a success clears both,
 * and the opt-out is honoured — all through the real worker path, with only the
 * mail provider faked (FR-NOTIF-1, NFR-OBS-1).
 */

beforeEach(resetDb)

/** Default detection threshold is 3 consecutive dead-letters (D-010). */
const THRESHOLD = 3

const failPermanent: DeliveryDispatcher = async () => ({
  ok: false,
  retryable: false,
  error: '502 from host',
})
const succeed: DeliveryDispatcher = async () => ({
  ok: true,
  responseStatus: 200,
})

/** A notifier wired to a fake mailer, exactly as the worker builds the real one. */
function fakeMailer() {
  const alerts: DeliveryHealthAlert[] = []
  const notify = buildDeliveryHealthNotifier({
    send: async (alert): Promise<MailResult> => {
      alerts.push(alert)
      return { ok: true, id: `mail-${alerts.length}` }
    },
  })
  return { alerts, notify }
}

async function seed(name = 'Ops webhook') {
  const f = await createForm()
  const [dest] = await db
    .insert(destination)
    .values({ formId: f.id, type: 'webhook', name, config: {} })
    .returning({ id: destination.id })
  if (!dest) throw new Error('failed to seed destination')
  return { form: f, destinationId: dest.id }
}

/** Queue one delivery for the destination and drain it through the worker. */
async function deliverOnce(
  formId: string,
  destinationId: string,
  dispatch: DeliveryDispatcher,
  notify: Parameters<typeof runWorkerOnce>[2],
) {
  const sub = await insertSubmission(formId)
  await db
    .insert(deliveryAttempt)
    .values({ submissionId: sub.id, destinationId })
  await runWorkerOnce(dispatch, 10, notify)
}

describe('delivery-health notification wiring', () => {
  it('mails the owner once when a destination crosses the threshold', async () => {
    const { form, destinationId } = await seed()
    const { alerts, notify } = fakeMailer()

    for (let i = 0; i < THRESHOLD + 2; i++) {
      await deliverOnce(form.id, destinationId, failPermanent, notify)
    }

    // One alert for the outage, not one per failed submission (the 24h cool-off).
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      formId: form.id,
      formName: 'Test Form',
      destinationId,
      destinationName: 'Ops webhook',
      destinationType: 'webhook',
      failureCount: THRESHOLD,
      lastError: '502 from host',
    })
    expect(alerts[0]?.lastFailedAt).toBeInstanceOf(Date)
  })

  it('shows the destination as failing on the dashboard, then clears it', async () => {
    const { form, destinationId } = await seed()
    const { notify } = fakeMailer()

    for (let i = 0; i < THRESHOLD; i++) {
      await deliverOnce(form.id, destinationId, failPermanent, notify)
    }

    const failing = await getFormForUser(form.ownerId, form.id)
    const flagged = failing?.destinations.find((d) => d.id === destinationId)
    expect(flagged?.health?.unhealthySince).toBeInstanceOf(Date)
    expect(flagged?.health?.consecutiveDeadLetters).toBe(THRESHOLD)
    expect(flagged?.health?.lastError).toBe('502 from host')

    await deliverOnce(form.id, destinationId, succeed, notify)

    const healthy = await getFormForUser(form.ownerId, form.id)
    const cleared = healthy?.destinations.find((d) => d.id === destinationId)
    expect(cleared?.health?.unhealthySince).toBeNull()
    expect(cleared?.health?.consecutiveDeadLetters).toBe(0)
  })

  it('sends no mail once the owner opts out, but still flags the destination', async () => {
    const { form, destinationId } = await seed()
    const { alerts, notify } = fakeMailer()

    expect(
      await setDeliveryHealthEmailsForUser(form.ownerId, form.id, false),
    ).toEqual({ ok: true })

    for (let i = 0; i < THRESHOLD; i++) {
      await deliverOnce(form.id, destinationId, failPermanent, notify)
    }

    expect(alerts).toHaveLength(0)
    const state = await getDestinationHealth(destinationId)
    expect(state.unhealthySince).not.toBeNull()

    const view = await getFormForUser(form.ownerId, form.id)
    expect(view?.deliveryHealthEmails).toBe(false)
    expect(
      view?.destinations.find((d) => d.id === destinationId)?.health
        ?.unhealthySince,
    ).not.toBeNull()
  })

  it('rejects an opt-out from someone who does not own the form', async () => {
    const { form } = await seed()
    const other = await createForm()

    expect(
      await setDeliveryHealthEmailsForUser(other.ownerId, form.id, false),
    ).toEqual({ ok: false, error: 'Form not found.' })

    const view = await getFormForUser(form.ownerId, form.id)
    expect(view?.deliveryHealthEmails).toBe(true)
  })

  it('keeps delivering when the mailer throws', async () => {
    const { form, destinationId } = await seed()
    const exploding = buildDeliveryHealthNotifier({
      send: async () => {
        throw new Error('mail provider down')
      },
    })

    for (let i = 0; i < THRESHOLD; i++) {
      await deliverOnce(form.id, destinationId, failPermanent, exploding)
    }

    const attempts = await db.select().from(deliveryAttempt)
    expect(attempts).toHaveLength(THRESHOLD)
    expect(attempts.every((a) => a.status === 'dead_letter')).toBe(true)
    expect(
      (await getDestinationHealth(destinationId)).consecutiveDeadLetters,
    ).toBe(THRESHOLD)
  })

  it('resolves a destination to its form, names, and opt-out flag', async () => {
    const { form, destinationId } = await seed('Email ops')

    const target = await lookupNotificationTarget(destinationId)
    expect(target).toMatchObject({
      formId: form.id,
      formName: 'Test Form',
      destinationName: 'Email ops',
      destinationType: 'webhook',
      emailsEnabled: true,
      // No terminal delivery yet, so there is no health row to read from.
      lastDeadLetterAt: null,
    })
  })

  it('resolves nothing for a destination that has been deleted', async () => {
    const { destinationId } = await seed()
    await db.delete(destination).where(eq(destination.id, destinationId))
    expect(await lookupNotificationTarget(destinationId)).toBeNull()
  })
})
