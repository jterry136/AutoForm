import { type } from 'arktype'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '~/db'
import { destination, form, formDefinition, submission } from '~/db/schema'
import { generatePublicId } from '~/lib/ids'
import { formDefinitionSchema } from '~/lib/validation'

/**
 * Form CRUD, always scoped to the owning user (FR-ACC-2). Passing `userId`
 * explicitly makes ownership the authorization boundary: a user can only read or
 * mutate their own forms. The thin server-function wrappers (in the dashboard
 * routes) resolve the session user and call these.
 *
 * Every form is created together with its mandatory definition (D-001), validated
 * via ArkType (D-002) before anything is persisted.
 */

export type Result<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: string }

export interface CreateFormInput {
  name: string
  definition: unknown
}

export async function createFormForUser(
  userId: string,
  input: CreateFormInput,
): Promise<Result<{ id: string; publicId: string }>> {
  const name = input.name?.trim()
  if (!name) return { ok: false, error: 'A form name is required.' }

  const definition = formDefinitionSchema(input.definition)
  if (definition instanceof type.errors) {
    return {
      ok: false,
      error: `Invalid form definition: ${definition.summary}`,
    }
  }

  const publicId = generatePublicId()
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(form)
      .values({ ownerId: userId, publicId, name })
      .returning({ id: form.id, publicId: form.publicId })
    if (!row) throw new Error('failed to insert form')
    await tx.insert(formDefinition).values({ formId: row.id, definition })
    return row
  })

  return { ok: true, value: created }
}

export async function listFormsForUser(userId: string) {
  return db
    .select({
      id: form.id,
      name: form.name,
      publicId: form.publicId,
      status: form.status,
      createdAt: form.createdAt,
      submissionCount: sql<number>`count(distinct ${submission.id})`.mapWith(
        Number,
      ),
      destinationCount: sql<number>`count(distinct ${destination.id})`.mapWith(
        Number,
      ),
    })
    .from(form)
    .leftJoin(submission, eq(submission.formId, form.id))
    .leftJoin(destination, eq(destination.formId, form.id))
    .where(eq(form.ownerId, userId))
    .groupBy(form.id)
    .orderBy(desc(form.createdAt))
}

export async function getFormForUser(userId: string, formId: string) {
  const row = await db.query.form.findFirst({
    where: (t, ops) => ops.and(ops.eq(t.id, formId), ops.eq(t.ownerId, userId)),
    with: {
      definition: true,
      destinations: { orderBy: (d, ops) => ops.desc(d.createdAt) },
    },
  })
  return row ?? null
}

export async function renameFormForUser(
  userId: string,
  formId: string,
  name: string,
): Promise<Result> {
  const trimmed = name?.trim()
  if (!trimmed) return { ok: false, error: 'A form name is required.' }
  const updated = await db
    .update(form)
    .set({ name: trimmed })
    .where(and(eq(form.id, formId), eq(form.ownerId, userId)))
    .returning({ id: form.id })
  return updated.length ? { ok: true } : { ok: false, error: 'Form not found.' }
}

export async function deleteFormForUser(
  userId: string,
  formId: string,
): Promise<Result> {
  const deleted = await db
    .delete(form)
    .where(and(eq(form.id, formId), eq(form.ownerId, userId)))
    .returning({ id: form.id })
  return deleted.length ? { ok: true } : { ok: false, error: 'Form not found.' }
}
