import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { submission } from '~/db/schema'
import { buildExportResponse } from '~/lib/export-download'
import { createFormForUser } from '~/lib/forms'
import { loadFormExport } from '~/lib/inbox'
import type { JsonObject } from '~/lib/json'
import { createOwner, resetDb } from '../../test/helpers'

/**
 * Export query + download endpoint (FR-SUB-4, D-008). The rules under test are
 * the ones a serializer unit test cannot reach: ownership scoping, the
 * authenticated download's status codes and headers, and the row cap.
 */

beforeEach(resetDb)

const definition = {
  version: 1,
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea' },
  ],
}

async function ownedForm(userId: string, name = 'Contact Us') {
  const res = await createFormForUser(userId, { name, definition })
  if (!res.ok) throw new Error(res.error)
  return res.value
}

/** Insert a submission with an explicit timestamp so ordering is deterministic. */
async function addSubmission(
  formId: string,
  payload: JsonObject,
  createdAt: Date,
): Promise<string> {
  const [row] = await db
    .insert(submission)
    .values({
      formId,
      rawBody: new URLSearchParams(
        Object.entries(payload).map(([k, v]) => [k, String(v)]),
      ).toString(),
      contentType: 'application/x-www-form-urlencoded',
      normalizedPayload: payload,
      createdAt,
    })
    .returning({ id: submission.id })
  if (!row) throw new Error('failed to insert submission')
  return row.id
}

async function seedThree(formId: string): Promise<string[]> {
  const ids: string[] = []
  ids.push(
    await addSubmission(
      formId,
      { email: 'first@example.test', message: 'one' },
      new Date('2026-03-01T10:00:00.000Z'),
    ),
  )
  ids.push(
    await addSubmission(
      formId,
      { email: 'second@example.test', message: 'two' },
      new Date('2026-03-02T10:00:00.000Z'),
    ),
  )
  ids.push(
    await addSubmission(
      formId,
      { email: 'third@example.test', message: 'three' },
      new Date('2026-03-03T10:00:00.000Z'),
    ),
  )
  return ids
}

describe('loadFormExport (ownership-scoped export query)', () => {
  it('returns the form’s submissions, newest first, with its definition', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const data = await loadFormExport(owner, form.id)
    expect(data).not.toBeNull()
    expect(data?.formName).toBe('Contact Us')
    expect(data?.definition.fields.map((f) => f.name)).toEqual([
      'email',
      'message',
    ])
    expect(data?.submissions.map((s) => s.normalizedPayload.email)).toEqual([
      'third@example.test',
      'second@example.test',
      'first@example.test',
    ])
    expect(data?.truncated).toBe(false)
  })

  it('is not limited to the inbox’s display window', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    for (let i = 0; i < 120; i++) {
      await addSubmission(
        form.id,
        { email: `user${i}@example.test` },
        new Date(Date.UTC(2026, 2, 1, 0, i)),
      )
    }

    const data = await loadFormExport(owner, form.id)
    expect(data?.submissions).toHaveLength(120)
    expect(data?.truncated).toBe(false)
  })

  it('returns null for another user’s form and for an unknown form', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    expect(await loadFormExport(stranger, form.id)).toBeNull()
    expect(
      await loadFormExport(owner, '00000000-0000-4000-8000-000000000000'),
    ).toBeNull()
  })

  it('caps the result and reports truncation', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const data = await loadFormExport(owner, form.id, 2)
    expect(data?.submissions).toHaveLength(2)
    expect(data?.truncated).toBe(true)
    // The cap keeps the *most recent* rows.
    expect(data?.submissions[0]?.normalizedPayload.email).toBe(
      'third@example.test',
    )

    const exact = await loadFormExport(owner, form.id, 3)
    expect(exact?.submissions).toHaveLength(3)
    expect(exact?.truncated).toBe(false)
  })
})

describe('buildExportResponse (authenticated download)', () => {
  const now = new Date('2026-03-09T12:00:00.000Z')

  it('rejects an unauthenticated request', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)

    const res = await buildExportResponse(null, form.id, 'csv', { now })
    expect(res.status).toBe(401)
    expect(res.headers.get('content-disposition')).toBeNull()
  })

  it('downloads CSV with the right content type and filename', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const res = await buildExportResponse(owner, form.id, 'csv', { now })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="contact-us-submissions-2026-03-09.csv"',
    )
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-export-row-count')).toBe('3')
    expect(res.headers.get('x-export-truncated')).toBeNull()

    const lines = (await res.text()).trim().split('\r\n')
    expect(lines[0]).toBe(
      'submission_id,submitted_at,delivery_status,email,message',
    )
    expect(lines).toHaveLength(4)
    expect(lines[1]).toContain('third@example.test')
  })

  it('downloads JSON when asked, with the payloads intact', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const res = await buildExportResponse(owner, form.id, 'json', { now })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(
      'application/json; charset=utf-8',
    )
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="contact-us-submissions-2026-03-09.json"',
    )

    const rows = JSON.parse(await res.text()) as Array<{
      id: string
      submittedAt: string
      deliveryStatus: string
      payload: Record<string, unknown>
    }>
    expect(rows).toHaveLength(3)
    expect(rows[0]?.payload).toEqual({
      email: 'third@example.test',
      message: 'three',
    })
    expect(rows[0]?.deliveryStatus).toBe('none')
  })

  it('exports a form with no submissions as a header-only file', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)

    const csv = await buildExportResponse(owner, form.id, 'csv', { now })
    expect(csv.status).toBe(200)
    expect(await csv.text()).toBe(
      'submission_id,submitted_at,delivery_status,email,message\r\n',
    )

    const json = await buildExportResponse(owner, form.id, 'json', { now })
    expect(await json.text()).toBe('[]\n')
  })

  it('gives a stranger the same 404 as a form that does not exist', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const foreign = await buildExportResponse(stranger, form.id, 'csv', { now })
    const missing = await buildExportResponse(
      stranger,
      '00000000-0000-4000-8000-000000000000',
      'csv',
      { now },
    )
    const malformed = await buildExportResponse(stranger, 'not-a-uuid', 'csv', {
      now,
    })

    expect(foreign.status).toBe(404)
    expect(missing.status).toBe(404)
    expect(malformed.status).toBe(404)

    const bodies = await Promise.all([
      foreign.text(),
      missing.text(),
      malformed.text(),
    ])
    expect(new Set(bodies).size).toBe(1)
  })

  it('rejects an unsupported format', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)

    const res = await buildExportResponse(owner, form.id, 'xlsx', { now })
    expect(res.status).toBe(400)
  })

  it('announces truncation in the response headers', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const res = await buildExportResponse(owner, form.id, 'csv', {
      now,
      limit: 2,
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-export-truncated')).toBe('true')
    expect(res.headers.get('x-export-row-limit')).toBe('2')
    expect(res.headers.get('x-export-row-count')).toBe('2')
    expect((await res.text()).trim().split('\r\n')).toHaveLength(3)
  })

  it('never leaks destination config or credentials', async () => {
    const owner = await createOwner()
    const form = await ownedForm(owner)
    await seedThree(form.id)

    const res = await buildExportResponse(owner, form.id, 'json', { now })
    const body = await res.text()
    expect(body).not.toContain('credential')
    expect(body).not.toContain('destination')
    expect(body).not.toContain('config')
  })
})
