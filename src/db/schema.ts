/**
 * Drizzle schema (Supabase Postgres) — the single place all tables are declared.
 *
 * Entities (REQUIREMENTS.md §8): Account (= Better Auth `user`), Form,
 * FormDefinition (required — DECISIONS.md D-001), Destination, Submission, and
 * DeliveryAttempt (which doubles as the delivery queue).
 *
 * Conventions: all DB access goes through Drizzle (no raw SQL in app code), and
 * column naming uses snake_case (configured in drizzle.config.ts + the client).
 */

import { relations } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { user } from './auth-schema'

// Better Auth tables (user, session, account, verification). `user` is the
// owning "Account" identity that domain tables reference.
export * from './auth-schema'

// ─── Enums (closed lifecycles) ───────────────────────────────────────────────
// Open-ended sets (destination.type, submission.spamVerdict) are plain text so
// new connectors/verdicts don't require an enum migration.

export const formStatus = pgEnum('form_status', ['active', 'disabled'])

export const deliveryStatus = pgEnum('delivery_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'dead_letter',
])

// ─── Form ────────────────────────────────────────────────────────────────────

export const form = pgTable(
  'form',
  {
    id: uuid().primaryKey().defaultRandom(),
    // High-entropy, unguessable public ID used in /f/{publicId} (FR-ACC-3,
    // NFR-SEC-5). Generated app-side at creation time.
    publicId: text().notNull().unique(),
    ownerId: text()
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    status: formStatus().notNull().default('active'),
    // Allowed Origin/Referer hosts for Phase 1 origin checks (FR-SPAM-3).
    // null = unrestricted (MVP default).
    allowedOrigins: text().array(),
    // Default post-submission redirect target; a per-submission `_redirect`
    // field overrides this (FR-EMB-2). null = use the hosted success page.
    redirectUrl: text(),
    // Honeypot field name injected into generated embeds (FR-SPAM-1).
    honeypotField: text().notNull().default('_gotcha'),
    // Per-form rate limit (FR-SPAM-2).
    rateLimitPerMinute: integer().notNull().default(60),
    // Retention policy (Q-3, pending). null = retain indefinitely (MVP default).
    retentionDays: integer(),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('form_owner_id_idx').on(t.ownerId)],
)

// ─── FormDefinition (required, one-to-one with Form — D-001) ──────────────────
// The unique FK enforces at-most-one definition per form; "every form has one"
// is enforced at the app layer (create form + definition together).

export const formDefinition = pgTable('form_definition', {
  id: uuid().primaryKey().defaultRandom(),
  formId: uuid()
    .notNull()
    .unique()
    .references(() => form.id, { onDelete: 'cascade' }),
  // Canonical definition JSON (fields, validation, destination references).
  // Validated/normalized via ArkType at the app layer (D-002).
  definition: jsonb().$type<Record<string, unknown>>().notNull(),
  version: integer().notNull().default(1),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

// ─── Destination ─────────────────────────────────────────────────────────────

export const destination = pgTable(
  'destination',
  {
    id: uuid().primaryKey().defaultRandom(),
    formId: uuid()
      .notNull()
      .references(() => form.id, { onDelete: 'cascade' }),
    // Connector key (e.g. 'webhook', 'email'). Validated against the connector
    // registry at the app layer (NFR-MAINT-1).
    type: text().notNull(),
    name: text().notNull(),
    // Non-secret, connector-specific config (webhook URL, email recipients…).
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    // Encrypted credential blob (P-2 / NFR-SEC-1). Storage format is settled by
    // the credential-encryption decision; a text blob accommodates any AES-GCM
    // ciphertext encoding. null = no per-destination secret.
    encryptedCredentials: text(),
    enabled: boolean().notNull().default(true),
    createdAt: timestamp().notNull().defaultNow(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('destination_form_id_idx').on(t.formId)],
)

// ─── Submission ──────────────────────────────────────────────────────────────

export const submission = pgTable(
  'submission',
  {
    id: uuid().primaryKey().defaultRandom(),
    formId: uuid()
      .notNull()
      .references(() => form.id, { onDelete: 'cascade' }),
    // Raw request body exactly as received (FR-ING-3).
    rawBody: text().notNull(),
    contentType: text(),
    // Structured key-value payload after normalization (FR-ING-2).
    normalizedPayload: jsonb().$type<Record<string, unknown>>().notNull(),
    // Metadata (FR-ING-5). clientFingerprint is a coarse, privacy-conscious
    // identifier (e.g. hashed IP) for abuse handling.
    referer: text(),
    clientFingerprint: text(),
    userAgent: text(),
    // 'clean' | 'honeypot' | 'rate_limited' | … (FR-SPAM-1/2).
    spamVerdict: text().notNull().default('clean'),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [index('submission_form_id_created_at_idx').on(t.formId, t.createdAt)],
)

// ─── DeliveryAttempt (also the delivery queue) ───────────────────────────────
// One row per attempt per (submission × destination). The poller claims rows
// where status='pending' and next_run_at <= now() using locked_at/locked_by; on
// failure it records the error and enqueues the next attempt with backoff, or
// dead-letters after the limit (FR-DEL-1/2/4, NFR-OBS-1, NFR-REL-2).

export const deliveryAttempt = pgTable(
  'delivery_attempt',
  {
    id: uuid().primaryKey().defaultRandom(),
    submissionId: uuid()
      .notNull()
      .references(() => submission.id, { onDelete: 'cascade' }),
    destinationId: uuid()
      .notNull()
      .references(() => destination.id, { onDelete: 'cascade' }),
    attempt: integer().notNull().default(1),
    status: deliveryStatus().notNull().default('pending'),
    nextRunAt: timestamp().notNull().defaultNow(),
    lockedAt: timestamp(),
    lockedBy: text(),
    responseStatus: integer(),
    responseBody: text(),
    error: text(),
    startedAt: timestamp(),
    finishedAt: timestamp(),
    createdAt: timestamp().notNull().defaultNow(),
  },
  (t) => [
    index('delivery_attempt_claim_idx').on(t.status, t.nextRunAt),
    index('delivery_attempt_submission_idx').on(t.submissionId),
    index('delivery_attempt_destination_idx').on(t.destinationId),
  ],
)

// ─── Relations ───────────────────────────────────────────────────────────────

export const userRelations = relations(user, ({ many }) => ({
  forms: many(form),
}))

export const formRelations = relations(form, ({ one, many }) => ({
  owner: one(user, { fields: [form.ownerId], references: [user.id] }),
  definition: one(formDefinition),
  destinations: many(destination),
  submissions: many(submission),
}))

export const formDefinitionRelations = relations(formDefinition, ({ one }) => ({
  form: one(form, {
    fields: [formDefinition.formId],
    references: [form.id],
  }),
}))

export const destinationRelations = relations(destination, ({ one, many }) => ({
  form: one(form, { fields: [destination.formId], references: [form.id] }),
  deliveryAttempts: many(deliveryAttempt),
}))

export const submissionRelations = relations(submission, ({ one, many }) => ({
  form: one(form, { fields: [submission.formId], references: [form.id] }),
  deliveryAttempts: many(deliveryAttempt),
}))

export const deliveryAttemptRelations = relations(
  deliveryAttempt,
  ({ one }) => ({
    submission: one(submission, {
      fields: [deliveryAttempt.submissionId],
      references: [submission.id],
    }),
    destination: one(destination, {
      fields: [deliveryAttempt.destinationId],
      references: [destination.id],
    }),
  }),
)
