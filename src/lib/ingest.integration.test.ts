import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { deliveryAttempt, form, submission } from '~/db/schema'
import { ingestSubmission } from '~/lib/ingest'
import { resetRateLimits } from '~/lib/spam'
import { addDestination, createForm, resetDb } from '../../test/helpers'

beforeEach(async () => {
  await resetDb()
  resetRateLimits()
})

function formPost(
  body: Record<string, string>,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/f/x', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...headers,
    },
    body: new URLSearchParams(body).toString(),
  })
}

async function attemptsFor(submissionId: string) {
  return db
    .select()
    .from(deliveryAttempt)
    .where(eq(deliveryAttempt.submissionId, submissionId))
}

describe('ingestSubmission — validate → persist → enqueue (Chunk 2 pipeline)', () => {
  it('persists a valid submission before enqueuing, and enqueues one job per destination (P-3/P-5)', async () => {
    const f = await createForm()
    await addDestination(f.id, 'webhook')
    await addDestination(f.id, 'email')

    const result = await ingestSubmission(
      formPost({ email: 'user@example.com', message: 'hi' }),
      f.publicId,
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const [row] = await db
      .select()
      .from(submission)
      .where(eq(submission.id, result.submissionId))
    expect(row?.normalizedPayload).toEqual({
      email: 'user@example.com',
      message: 'hi',
    })

    const attempts = await attemptsFor(result.submissionId)
    expect(attempts).toHaveLength(2)
    expect(attempts.every((a) => a.status === 'pending')).toBe(true)
  })

  it('stores the submission even when the form has no destinations', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      formPost({ email: 'user@example.com' }),
      f.publicId,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(await attemptsFor(result.submissionId)).toHaveLength(0)
  })

  it('resolves _redirect and strips an empty honeypot field (FR-EMB-2)', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      formPost({
        email: 'user@example.com',
        _redirect: '/thanks',
        _gotcha: '', // present (as the embed renders it) but not tripped
      }),
      f.publicId,
    )
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.redirectTarget).toBe('/thanks')
  })

  it('accepts a JSON body (FR-ING-1)', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      new Request('http://localhost/f/x', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'json@example.com' }),
      }),
      f.publicId,
    )
    expect(result.status).toBe('ok')
  })

  it('rejects unknown fields (D-001)', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      formPost({ email: 'user@example.com', not_a_field: 'x' }),
      f.publicId,
    )
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') {
      expect(result.errors.some((e) => e.field === 'not_a_field')).toBe(true)
    }
  })

  it('rejects a submission missing a required field', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      formPost({ message: 'no email' }),
      f.publicId,
    )
    expect(result.status).toBe('invalid')
  })

  it('returns not_found for an unknown public ID', async () => {
    const result = await ingestSubmission(
      formPost({ email: 'a@b.co' }),
      'pub_missing',
    )
    expect(result.status).toBe('not_found')
  })

  it('returns unsupported_media for a non-form content type', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      new Request('http://localhost/f/x', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'hello',
      }),
      f.publicId,
    )
    expect(result.status).toBe('unsupported_media')
  })
})

describe('spam & abuse protection (Chunk 7)', () => {
  it('silently rejects a submission that fills the honeypot (FR-SPAM-1)', async () => {
    const f = await createForm()
    await addDestination(f.id)
    const result = await ingestSubmission(
      formPost({ email: 'user@example.com', _gotcha: 'i am a bot' }),
      f.publicId,
    )
    expect(result.status).toBe('spam')

    // Nothing persisted, nothing enqueued.
    const subs = await db
      .select()
      .from(submission)
      .where(eq(submission.formId, f.id))
    expect(subs).toHaveLength(0)
  })

  it('accepts a submission whose honeypot is present but empty', async () => {
    const f = await createForm()
    const result = await ingestSubmission(
      formPost({ email: 'user@example.com', _gotcha: '' }),
      f.publicId,
    )
    expect(result.status).toBe('ok')
  })

  it('rate-limits repeated submissions from the same IP (FR-SPAM-2)', async () => {
    const f = await createForm()
    await db
      .update(form)
      .set({ rateLimitPerMinute: 2 })
      .where(eq(form.id, f.id))
    const headers = { 'x-forwarded-for': '203.0.113.5' }

    const first = await ingestSubmission(
      formPost({ email: 'a@b.co' }, headers),
      f.publicId,
    )
    const second = await ingestSubmission(
      formPost({ email: 'a@b.co' }, headers),
      f.publicId,
    )
    const third = await ingestSubmission(
      formPost({ email: 'a@b.co' }, headers),
      f.publicId,
    )

    expect(first.status).toBe('ok')
    expect(second.status).toBe('ok')
    expect(third.status).toBe('rate_limited')
  })
})
