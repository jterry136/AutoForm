import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { db } from '~/db'
import {
  destination,
  form,
  formDefinition,
  submission,
  user,
} from '~/db/schema'

/** Truncate all domain + auth tables between tests for a clean slate. */
export async function resetDb(): Promise<void> {
  await db.execute(sql`TRUNCATE TABLE
    delivery_attempt, submission, destination, form_definition, form,
    "session", "account", verification, "user"
    RESTART IDENTITY CASCADE`)
}

export async function createOwner(): Promise<string> {
  const id = randomUUID()
  await db.insert(user).values({
    id,
    name: 'Test Owner',
    email: `${id}@example.test`,
    emailVerified: true,
  })
  return id
}

const DEFAULT_DEFINITION: Record<string, unknown> = {
  version: 1,
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'message', label: 'Message', type: 'textarea' },
  ],
}

export async function createForm(
  options: {
    definition?: Record<string, unknown>
    honeypotField?: string
    redirectUrl?: string | null
  } = {},
): Promise<{ id: string; publicId: string }> {
  const ownerId = await createOwner()
  const publicId = `pub_${randomUUID().replace(/-/g, '').slice(0, 16)}`
  const [row] = await db
    .insert(form)
    .values({
      ownerId,
      publicId,
      name: 'Test Form',
      honeypotField: options.honeypotField ?? '_gotcha',
      redirectUrl: options.redirectUrl ?? null,
    })
    .returning({ id: form.id, publicId: form.publicId })
  if (!row) throw new Error('failed to create form')

  await db.insert(formDefinition).values({
    formId: row.id,
    definition: options.definition ?? DEFAULT_DEFINITION,
  })
  return row
}

export async function addDestination(
  formId: string,
  type = 'webhook',
  config: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const [row] = await db
    .insert(destination)
    .values({ formId, type, name: type, config })
    .returning({ id: destination.id })
  if (!row) throw new Error('failed to create destination')
  return row
}

export async function insertSubmission(
  formId: string,
): Promise<{ id: string }> {
  const [row] = await db
    .insert(submission)
    .values({
      formId,
      rawBody: 'email=a%40b.co',
      contentType: 'application/x-www-form-urlencoded',
      normalizedPayload: { email: 'a@b.co' },
    })
    .returning({ id: submission.id })
  if (!row) throw new Error('failed to create submission')
  return row
}
