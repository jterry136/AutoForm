import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { destination, deliveryAttempt, form } from '~/db/schema'
import { decrypt } from '~/lib/crypto'
import {
  addDestinationForUser,
  deleteDestinationForUser,
} from '~/lib/destinations'
import {
  createFormForUser,
  deleteFormForUser,
  getFormForUser,
  listFormsForUser,
  renameFormForUser,
  setRetentionForUser,
} from '~/lib/forms'
import {
  deleteAllSubmissionsForForm,
  deleteSubmissionForUser,
  listSubmissionsForForm,
} from '~/lib/inbox'
import { DEFAULT_RETENTION_DAYS, MAX_RETENTION_DAYS } from '~/lib/retention'
import { createOwner, insertSubmission, resetDb } from '../../test/helpers'

beforeEach(resetDb)

const validDefinition = {
  version: 1,
  fields: [{ name: 'email', label: 'Email', type: 'email', required: true }],
}

async function ownedForm(userId: string, name = 'My Form') {
  const res = await createFormForUser(userId, {
    name,
    definition: validDefinition,
  })
  if (!res.ok) throw new Error(res.error)
  return res.value
}

describe('form CRUD (FR-ACC-2, D-001)', () => {
  it('creates a form with a generated public ID and mandatory definition', async () => {
    const user = await createOwner()
    const res = await createFormForUser(user, {
      name: 'Contact',
      definition: validDefinition,
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.value.publicId).toMatch(/^f_/)

    const loaded = await getFormForUser(user, res.value.id)
    expect(loaded?.definition?.definition).toMatchObject({ version: 1 })
  })

  it('rejects an invalid definition (D-001/D-002)', async () => {
    const user = await createOwner()
    const res = await createFormForUser(user, {
      name: 'Bad',
      definition: { version: 1, fields: [] },
    })
    expect(res.ok).toBe(false)
  })

  it('lists only the owner’s forms with submission counts', async () => {
    const userA = await createOwner()
    const userB = await createOwner()
    const a = await ownedForm(userA, 'A form')
    await ownedForm(userB, 'B form')
    await insertSubmission(a.id)

    const listA = await listFormsForUser(userA)
    expect(listA).toHaveLength(1)
    expect(listA[0]?.name).toBe('A form')
    expect(listA[0]?.submissionCount).toBe(1)
  })

  it('scopes get/rename/delete to the owner', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const form = await ownedForm(owner)

    expect(await getFormForUser(stranger, form.id)).toBeNull()
    expect((await renameFormForUser(stranger, form.id, 'Hacked')).ok).toBe(
      false,
    )
    expect((await deleteFormForUser(stranger, form.id)).ok).toBe(false)

    expect((await renameFormForUser(owner, form.id, 'Renamed')).ok).toBe(true)
    const reloaded = await getFormForUser(owner, form.id)
    expect(reloaded?.name).toBe('Renamed')
    expect((await deleteFormForUser(owner, form.id)).ok).toBe(true)
    expect(await getFormForUser(owner, form.id)).toBeNull()
  })
})

describe('retention policy (FR-SUB-3, D-011)', () => {
  async function retentionOf(formId: string) {
    const [row] = await db
      .select({ retentionDays: form.retentionDays })
      .from(form)
      .where(eq(form.id, formId))
    return row?.retentionDays
  }

  it('gives new forms the default window', async () => {
    const user = await createOwner()
    const created = await ownedForm(user)
    expect(await retentionOf(created.id)).toBe(DEFAULT_RETENTION_DAYS)
  })

  it('stores each of the three states', async () => {
    const user = await createOwner()
    const created = await ownedForm(user)

    expect((await setRetentionForUser(user, created.id, null)).ok).toBe(true)
    expect(await retentionOf(created.id)).toBeNull()

    expect((await setRetentionForUser(user, created.id, 0)).ok).toBe(true)
    expect(await retentionOf(created.id)).toBe(0)

    expect((await setRetentionForUser(user, created.id, 30)).ok).toBe(true)
    expect(await retentionOf(created.id)).toBe(30)

    expect(
      (await setRetentionForUser(user, created.id, MAX_RETENTION_DAYS)).ok,
    ).toBe(true)
    expect(await retentionOf(created.id)).toBe(MAX_RETENTION_DAYS)
  })

  it('rejects invalid values without changing the stored policy', async () => {
    const user = await createOwner()
    const created = await ownedForm(user)
    await setRetentionForUser(user, created.id, 30)

    for (const invalid of [
      -1,
      MAX_RETENTION_DAYS + 1,
      1.5,
      '30',
      'forever',
      undefined,
      {},
    ]) {
      const res = await setRetentionForUser(user, created.id, invalid)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/retention/i)
    }
    expect(await retentionOf(created.id)).toBe(30)
  })

  it('does not let a stranger change retention (D-008)', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const created = await ownedForm(owner)
    await setRetentionForUser(owner, created.id, 30)

    const res = await setRetentionForUser(stranger, created.id, 0)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Form not found.')
    expect(await retentionOf(created.id)).toBe(30)
  })

  it('reports an unknown form the same way as someone else’s', async () => {
    const user = await createOwner()
    const res = await setRetentionForUser(
      user,
      '00000000-0000-0000-0000-000000000000',
      30,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Form not found.')
  })
})

describe('destination management (FR-CON-6, P-2)', () => {
  it('adds a webhook destination and encrypts its secret at rest', async () => {
    const user = await createOwner()
    const form = await ownedForm(user)
    const res = await addDestinationForUser(user, {
      formId: form.id,
      type: 'webhook',
      name: 'My hook',
      config: { url: 'https://example.com/hook' },
      secret: 'bearer-token',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return

    const [row] = await db
      .select()
      .from(destination)
      .where(eq(destination.id, res.value.id))
    expect(row?.encryptedCredentials).toBeTruthy()
    expect(row?.encryptedCredentials).not.toBe('bearer-token')
    expect(decrypt(row!.encryptedCredentials!)).toBe('bearer-token')
  })

  it('rejects an invalid connector config at setup time', async () => {
    const user = await createOwner()
    const form = await ownedForm(user)
    const res = await addDestinationForUser(user, {
      formId: form.id,
      type: 'webhook',
      name: 'No URL',
      config: {},
    })
    expect(res.ok).toBe(false)
  })

  it('does not let a stranger add or delete destinations', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const form = await ownedForm(owner)
    const added = await addDestinationForUser(owner, {
      formId: form.id,
      type: 'webhook',
      name: 'hook',
      config: { url: 'https://example.com' },
    })
    if (!added.ok) throw new Error(added.error)

    expect(
      (
        await addDestinationForUser(stranger, {
          formId: form.id,
          type: 'webhook',
          name: 'x',
          config: { url: 'https://e.com' },
        })
      ).ok,
    ).toBe(false)
    expect((await deleteDestinationForUser(stranger, added.value.id)).ok).toBe(
      false,
    )
    expect((await deleteDestinationForUser(owner, added.value.id)).ok).toBe(
      true,
    )
  })
})

describe('submission inbox (FR-SUB-2, NFR-OBS-1)', () => {
  it('returns submissions with a rolled-up delivery status', async () => {
    const user = await createOwner()
    const form = await ownedForm(user)
    const dest = await addDestinationForUser(user, {
      formId: form.id,
      type: 'webhook',
      name: 'hook',
      config: { url: 'https://example.com' },
    })
    if (!dest.ok) throw new Error(dest.error)
    const sub = await insertSubmission(form.id)
    await db.insert(deliveryAttempt).values({
      submissionId: sub.id,
      destinationId: dest.value.id,
      status: 'succeeded',
    })

    const inbox = await listSubmissionsForForm(user, form.id)
    expect(inbox).not.toBeNull()
    expect(inbox?.retentionDays).toBe(DEFAULT_RETENTION_DAYS)
    expect(inbox?.submissions).toHaveLength(1)
    expect(inbox?.submissions[0]?.deliveryStatus).toBe('delivered')
    expect(inbox?.submissions[0]?.deliveries[0]?.status).toBe('succeeded')
    expect(inbox?.submissions[0]?.purgedAt).toBeNull()
  })

  it('uses the latest attempt per destination for the rollup', async () => {
    const user = await createOwner()
    const form = await ownedForm(user)
    const dest = await addDestinationForUser(user, {
      formId: form.id,
      type: 'webhook',
      name: 'hook',
      config: { url: 'https://example.com' },
    })
    if (!dest.ok) throw new Error(dest.error)
    const sub = await insertSubmission(form.id)
    // attempt 1 failed, attempt 2 succeeded → latest wins → delivered.
    await db.insert(deliveryAttempt).values([
      {
        submissionId: sub.id,
        destinationId: dest.value.id,
        attempt: 1,
        status: 'failed',
      },
      {
        submissionId: sub.id,
        destinationId: dest.value.id,
        attempt: 2,
        status: 'succeeded',
      },
    ])
    const inbox = await listSubmissionsForForm(user, form.id)
    expect(inbox?.submissions[0]?.deliveryStatus).toBe('delivered')
  })

  it('returns null for a non-owner', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const form = await ownedForm(owner)
    expect(await listSubmissionsForForm(stranger, form.id)).toBeNull()
  })
})

describe('manual submission deletion (NFR-PRIV-2, D-008)', () => {
  async function formWithSubmissions(userId: string, count: number) {
    const form = await ownedForm(userId)
    const ids: string[] = []
    for (let i = 0; i < count; i++)
      ids.push((await insertSubmission(form.id)).id)
    return { form, ids }
  }

  it('deletes a single submission and cascades its delivery attempts', async () => {
    const user = await createOwner()
    const { form, ids } = await formWithSubmissions(user, 2)
    const dest = await addDestinationForUser(user, {
      formId: form.id,
      type: 'webhook',
      name: 'hook',
      config: { url: 'https://example.com' },
    })
    if (!dest.ok) throw new Error(dest.error)
    await db.insert(deliveryAttempt).values({
      submissionId: ids[0]!,
      destinationId: dest.value.id,
      status: 'succeeded',
    })

    const res = await deleteSubmissionForUser(user, ids[0]!)
    expect(res.ok).toBe(true)

    const inbox = await listSubmissionsForForm(user, form.id)
    expect(inbox?.submissions).toHaveLength(1)
    expect(inbox?.submissions[0]?.id).toBe(ids[1])

    const attempts = await db
      .select()
      .from(deliveryAttempt)
      .where(eq(deliveryAttempt.submissionId, ids[0]!))
    expect(attempts).toHaveLength(0)
  })

  it('does not let a stranger delete a submission, and says only “not found”', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const { form, ids } = await formWithSubmissions(owner, 1)

    const res = await deleteSubmissionForUser(stranger, ids[0]!)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Submission not found.')
    expect(
      (await listSubmissionsForForm(owner, form.id))?.submissions,
    ).toHaveLength(1)
  })

  it('reports “not found” for an unknown submission id', async () => {
    const user = await createOwner()
    const res = await deleteSubmissionForUser(user, randomUUID())
    expect(res.ok).toBe(false)
  })

  it('purges every submission for a form, keeping the form itself', async () => {
    const user = await createOwner()
    const { form } = await formWithSubmissions(user, 3)

    const res = await deleteAllSubmissionsForForm(user, form.id)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.deleted).toBe(3)

    expect((await listSubmissionsForForm(user, form.id))?.submissions).toEqual(
      [],
    )
    expect(await getFormForUser(user, form.id)).not.toBeNull()
  })

  it('purges only the target form’s submissions', async () => {
    const user = await createOwner()
    const target = await formWithSubmissions(user, 2)
    const other = await formWithSubmissions(user, 1)

    const res = await deleteAllSubmissionsForForm(user, target.form.id)
    expect(res.ok).toBe(true)
    expect(
      (await listSubmissionsForForm(user, other.form.id))?.submissions,
    ).toHaveLength(1)
  })

  it('succeeds with a zero count when the inbox is already empty', async () => {
    const user = await createOwner()
    const form = await ownedForm(user)
    const res = await deleteAllSubmissionsForForm(user, form.id)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.value.deleted).toBe(0)
  })

  it('does not let a stranger purge a form’s submissions', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const { form } = await formWithSubmissions(owner, 2)

    const res = await deleteAllSubmissionsForForm(stranger, form.id)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('Form not found.')
    expect(
      (await listSubmissionsForForm(owner, form.id))?.submissions,
    ).toHaveLength(2)
  })
})
