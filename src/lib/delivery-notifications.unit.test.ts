import { describe, expect, it, vi } from 'vitest'
import type { DeliveryHealthSignal } from '~/lib/delivery-health'
import {
  decideNotification,
  handleHealthSignal,
  type NotificationTarget,
} from '~/lib/delivery-notifications'
import type { DeliveryHealthAlert, MailResult } from '~/lib/mailer'

/**
 * The signal → alert bridge, exercised without a database or a mail provider.
 * Both dependencies are injected, so what is under test here is purely the
 * routing rules: recovery is not mailed, an opt-out is honoured, a deleted
 * destination is a no-op, and nothing thrown by the mailer escapes.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 7, 1, 0, minute))

const unhealthy: DeliveryHealthSignal = {
  kind: 'unhealthy',
  destinationId: 'dest-1',
  consecutiveDeadLetters: 3,
  since: at(0),
  lastError: '502 from host',
}

const recovered: DeliveryHealthSignal = {
  kind: 'recovered',
  destinationId: 'dest-1',
  recoveredAt: at(9),
}

const target: NotificationTarget = {
  formId: 'form-1',
  formName: 'Contact us',
  destinationName: 'Ops webhook',
  destinationType: 'webhook',
  emailsEnabled: true,
  lastDeadLetterAt: at(7),
}

describe('decideNotification', () => {
  it('builds an alert from the signal and the resolved destination', () => {
    const decision = decideNotification(unhealthy, target)
    expect(decision).toEqual({
      action: 'send',
      alert: {
        formId: 'form-1',
        formName: 'Contact us',
        destinationId: 'dest-1',
        destinationName: 'Ops webhook',
        destinationType: 'webhook',
        failureCount: 3,
        lastError: '502 from host',
        lastFailedAt: at(7),
      },
    })
  })

  it('falls back to the outage start when no dead-letter timestamp is stored', () => {
    const decision = decideNotification(unhealthy, {
      ...target,
      lastDeadLetterAt: null,
    })
    expect(decision).toMatchObject({ alert: { lastFailedAt: at(0) } })
  })

  it('never mails a recovery — the dashboard badge clearing is the signal', () => {
    expect(decideNotification(recovered, target)).toEqual({
      action: 'skip',
      reason: 'recovered',
    })
  })

  it('honours the per-form opt-out', () => {
    expect(
      decideNotification(unhealthy, { ...target, emailsEnabled: false }),
    ).toEqual({ action: 'skip', reason: 'opted_out' })
  })

  it('skips a destination that no longer resolves', () => {
    expect(decideNotification(unhealthy, null)).toEqual({
      action: 'skip',
      reason: 'unknown_destination',
    })
  })

  it('carries no submission content into the alert', () => {
    const decision = decideNotification(unhealthy, target)
    expect(decision.action).toBe('send')
    if (decision.action !== 'send') return
    // Structural guarantee: the alert has no payload-shaped field at all.
    expect(Object.keys(decision.alert).sort()).toEqual([
      'destinationId',
      'destinationName',
      'destinationType',
      'failureCount',
      'formId',
      'formName',
      'lastError',
      'lastFailedAt',
    ])
  })
})

describe('handleHealthSignal', () => {
  const ok: MailResult = { ok: true, id: 'mail-1' }

  it('sends for an unhealthy destination', async () => {
    const send = vi.fn(async () => ok)
    const lookup = vi.fn(async () => target)

    const outcome = await handleHealthSignal(unhealthy, { lookup, send })

    expect(outcome).toEqual({ sent: true, result: ok })
    expect(lookup).toHaveBeenCalledWith('dest-1')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not even look the destination up for a recovery', async () => {
    const send = vi.fn(async () => ok)
    const lookup = vi.fn(async () => target)

    const outcome = await handleHealthSignal(recovered, { lookup, send })

    expect(outcome).toEqual({ sent: false, reason: 'recovered' })
    expect(lookup).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('sends nothing when the owner has opted out', async () => {
    const send = vi.fn(async () => ok)
    const outcome = await handleHealthSignal(unhealthy, {
      lookup: async () => ({ ...target, emailsEnabled: false }),
      send,
    })

    expect(outcome).toEqual({ sent: false, reason: 'opted_out' })
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows a throwing lookup so the worker cannot be stalled', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const outcome = await handleHealthSignal(unhealthy, {
        lookup: async () => {
          throw new Error('database is down')
        },
      })
      expect(outcome).toEqual({ sent: false, reason: 'error' })
    } finally {
      error.mockRestore()
    }
  })

  it('swallows a throwing mailer too', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const outcome = await handleHealthSignal(unhealthy, {
        lookup: async () => target,
        send: async () => {
          throw new Error('provider exploded')
        },
      })
      expect(outcome).toEqual({ sent: false, reason: 'error' })
    } finally {
      error.mockRestore()
    }
  })

  it('reports a failed send without treating it as a crash', async () => {
    const failed: MailResult = { ok: false, error: 'Resend rejected the call' }
    const outcome = await handleHealthSignal(unhealthy, {
      lookup: async () => target,
      send: async (alert: DeliveryHealthAlert) => {
        expect(alert.destinationId).toBe('dest-1')
        return failed
      },
    })
    expect(outcome).toEqual({ sent: true, result: failed })
  })
})
