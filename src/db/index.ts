import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { env } from '~/lib/env'
import * as schema from './schema'

/**
 * Drizzle client backed by Supabase Postgres.
 *
 * `prepare: false` is required when connecting through Supabase's Transaction
 * pooler (the recommended pooled connection for serverless/edge runtimes), which
 * does not support prepared statements.
 *
 * Import `db` only from server code — it depends on `env`, which holds secrets.
 */
const client = postgres(env.DATABASE_URL, { prepare: false })

export const db = drizzle(client, { schema, casing: 'snake_case' })
