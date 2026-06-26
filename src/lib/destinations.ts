import { and, eq } from 'drizzle-orm'
import { getConnector } from '~/connectors'
import { db } from '~/db'
import { destination, form } from '~/db/schema'
import { encrypt } from '~/lib/crypto'
import type { Result } from '~/lib/forms'

/**
 * Destination management, scoped to the owning user (FR-DEL-3, FR-CON-6). The
 * connector's `validateConfig` is run at setup time, and any secret is encrypted
 * at rest (P-2) before it touches the database.
 */

export interface AddDestinationInput {
  formId: string
  type: string
  name: string
  config: Record<string, unknown>
  /** Optional plaintext secret (e.g. webhook bearer token); encrypted here. */
  secret?: string | null
}

async function ownsForm(userId: string, formId: string): Promise<boolean> {
  const rows = await db
    .select({ id: form.id })
    .from(form)
    .where(and(eq(form.id, formId), eq(form.ownerId, userId)))
  return rows.length > 0
}

export async function addDestinationForUser(
  userId: string,
  input: AddDestinationInput,
): Promise<Result<{ id: string }>> {
  const name = input.name?.trim()
  if (!name) return { ok: false, error: 'A destination name is required.' }
  if (!(await ownsForm(userId, input.formId))) {
    return { ok: false, error: 'Form not found.' }
  }

  const connector = getConnector(input.type)
  if (!connector) {
    return { ok: false, error: `Unknown destination type "${input.type}".` }
  }
  const check = connector.validateConfig?.(input.config) ?? { ok: true }
  if (!check.ok) {
    return { ok: false, error: check.error ?? 'Invalid destination config.' }
  }

  const encryptedCredentials = input.secret ? encrypt(input.secret) : null
  const [row] = await db
    .insert(destination)
    .values({
      formId: input.formId,
      type: input.type,
      name,
      config: input.config,
      encryptedCredentials,
    })
    .returning({ id: destination.id })
  if (!row) return { ok: false, error: 'Failed to create destination.' }
  return { ok: true, value: { id: row.id } }
}

export async function deleteDestinationForUser(
  userId: string,
  destinationId: string,
): Promise<Result> {
  // Only delete when the destination belongs to a form the user owns.
  const owned = await db
    .select({ id: destination.id })
    .from(destination)
    .innerJoin(form, eq(destination.formId, form.id))
    .where(and(eq(destination.id, destinationId), eq(form.ownerId, userId)))
  if (!owned.length) return { ok: false, error: 'Destination not found.' }

  await db.delete(destination).where(eq(destination.id, destinationId))
  return { ok: true }
}
