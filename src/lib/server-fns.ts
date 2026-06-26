import { createServerFn } from '@tanstack/react-start'
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
import type { JsonObject } from '~/lib/json'
import { getCurrentUser, requireUserId } from '~/lib/server-session'

/**
 * Server functions: thin, auth-resolving wrappers over the data layer. Each
 * resolves the session user server-side and delegates to a `*ForUser` function,
 * so ownership is always enforced. Safe to import into client route modules — the
 * Start compiler replaces the bodies with RPC stubs on the client.
 *
 * Secrets never cross to the client: `getFormFn` returns a DTO without
 * `encryptedCredentials`.
 */

export const getSessionUserFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const user = await getCurrentUser()
    return user ? { id: user.id, email: user.email, name: user.name } : null
  },
)

export const listFormsFn = createServerFn({ method: 'GET' }).handler(
  async () => {
    const userId = await requireUserId()
    return listFormsForUser(userId)
  },
)

export const getFormFn = createServerFn({ method: 'GET' })
  .validator((data: { formId: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    const form = await getFormForUser(userId, data.formId)
    if (!form) return null
    return {
      id: form.id,
      name: form.name,
      publicId: form.publicId,
      status: form.status,
      redirectUrl: form.redirectUrl,
      honeypotField: form.honeypotField,
      createdAt: form.createdAt,
      definition: (form.definition?.definition ?? null) as JsonObject | null,
      destinations: form.destinations.map((d) => ({
        id: d.id,
        type: d.type,
        name: d.name,
        config: d.config as JsonObject,
        enabled: d.enabled,
        hasCredentials: d.encryptedCredentials !== null,
      })),
    }
  })

export const createFormFn = createServerFn({ method: 'POST' })
  .validator((data: { name: string; definition: unknown }) => data)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return createFormForUser(userId, data)
  })

export const renameFormFn = createServerFn({ method: 'POST' })
  .validator((data: { formId: string; name: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return renameFormForUser(userId, data.formId, data.name)
  })

export const deleteFormFn = createServerFn({ method: 'POST' })
  .validator((data: { formId: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return deleteFormForUser(userId, data.formId)
  })

export const addDestinationFn = createServerFn({ method: 'POST' })
  .validator(
    (data: {
      formId: string
      type: string
      name: string
      config: Record<string, unknown>
      secret?: string | null
    }) => data,
  )
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return addDestinationForUser(userId, data)
  })

export const deleteDestinationFn = createServerFn({ method: 'POST' })
  .validator((data: { destinationId: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return deleteDestinationForUser(userId, data.destinationId)
  })

export const listInboxFn = createServerFn({ method: 'GET' })
  .validator((data: { formId: string }) => data)
  .handler(async ({ data }) => {
    const userId = await requireUserId()
    return listSubmissionsForForm(userId, data.formId)
  })
