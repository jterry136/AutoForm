import { defineConfig } from 'drizzle-kit'

// Drizzle Kit configuration for the Supabase Postgres database.
// DATABASE_URL is read from the environment (see .env.example). Run migrations
// with `npm run db:migrate`. When invoking Drizzle Kit, ensure the env is loaded
// (e.g. `node --env-file=.env ...` or your shell exporting DATABASE_URL).
export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? '',
  },
  casing: 'snake_case',
  strict: true,
  verbose: true,
})
