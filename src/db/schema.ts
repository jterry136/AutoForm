/**
 * Drizzle schema (Supabase Postgres) — the single place all tables are declared.
 *
 * The entities are defined in Chunk 1 (Data model & migrations): Account, Form,
 * FormDefinition (required — see DECISIONS.md D-001), Destination, Submission,
 * and DeliveryAttempt / delivery jobs. See REQUIREMENTS.md §8 for the high-level
 * data model.
 *
 * Conventions: all DB access goes through Drizzle (no raw SQL in app code), and
 * column naming uses snake_case (configured in drizzle.config.ts).
 */

export {}
