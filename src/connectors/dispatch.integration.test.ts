import { type Server, createServer } from 'node:http'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { dispatchDelivery } from '~/connectors'
import { db } from '~/db'
import { deliveryAttempt } from '~/db/schema'
import { enqueueDeliveries, runWorkerOnce } from '~/lib/queue'
import {
  addDestination,
  createForm,
  insertSubmission,
  resetDb,
} from '../../test/helpers'

let server: Server
let baseUrl: string
let received: { body: string } | null = null
let respondStatus = 200

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      received = { body }
      res.statusCode = respondStatus
      res.end('ok')
    })
  })
  await new Promise<void>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve()),
  )
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  baseUrl = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

beforeEach(async () => {
  received = null
  respondStatus = 200
  await resetDb()
})

function attemptsFor(submissionId: string) {
  return db
    .select()
    .from(deliveryAttempt)
    .where(eq(deliveryAttempt.submissionId, submissionId))
}

describe('end-to-end delivery via the real connector dispatcher (Milestone A)', () => {
  it('delivers a submission to a webhook destination and marks it succeeded', async () => {
    const form = await createForm()
    const dest = await addDestination(form.id, 'webhook', { url: baseUrl })
    const sub = await insertSubmission(form.id) // normalizedPayload { email: 'a@b.co' }
    await enqueueDeliveries(sub.id, [dest.id])

    const processed = await runWorkerOnce(dispatchDelivery)
    expect(processed).toBe(1)

    // The webhook actually fired with the normalized payload.
    expect(received).not.toBeNull()
    expect(JSON.parse(received!.body)).toEqual({ email: 'a@b.co' })

    const [attempt] = await attemptsFor(sub.id)
    expect(attempt?.status).toBe('succeeded')
    expect(attempt?.responseStatus).toBe(200)
  })

  it('drives the queue retry path when the webhook returns 5xx', async () => {
    respondStatus = 500
    const form = await createForm()
    const dest = await addDestination(form.id, 'webhook', { url: baseUrl })
    const sub = await insertSubmission(form.id)
    await enqueueDeliveries(sub.id, [dest.id])

    await runWorkerOnce(dispatchDelivery)

    const rows = await attemptsFor(sub.id)
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.status === 'failed')).toBe(true)
    expect(rows.some((r) => r.status === 'pending' && r.attempt === 2)).toBe(
      true,
    )
  })

  it('dead-letters a destination type with no registered connector', async () => {
    const form = await createForm()
    const dest = await addDestination(form.id, 'slack', {}) // no slack connector yet
    const sub = await insertSubmission(form.id)
    await enqueueDeliveries(sub.id, [dest.id])

    await runWorkerOnce(dispatchDelivery)

    const [attempt] = await attemptsFor(sub.id)
    expect(attempt?.status).toBe('dead_letter')
  })
})
