import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '~/db'
import { destination, deliveryAttempt } from '~/db/schema'
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
} from '~/lib/forms'
import { listSubmissionsForForm } from '~/lib/inbox'
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
    expect(inbox).toHaveLength(1)
    expect(inbox![0]?.deliveryStatus).toBe('delivered')
    expect(inbox![0]?.deliveries[0]?.status).toBe('succeeded')
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
    expect(inbox![0]?.deliveryStatus).toBe('delivered')
  })

  it('returns null for a non-owner', async () => {
    const owner = await createOwner()
    const stranger = await createOwner()
    const form = await ownedForm(owner)
    expect(await listSubmissionsForForm(stranger, form.id)).toBeNull()
  })
})
