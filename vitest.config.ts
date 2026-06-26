import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const srcDir = fileURLToPath(new URL('./src', import.meta.url))

/**
 * Test harness. A single ephemeral Postgres (Docker) is started once in
 * `test/global-setup.ts`, the schema migrations are applied to it, and all tests
 * run against it. Unit tests (`*.unit.test.ts`) ignore the DB; integration tests
 * (`*.integration.test.ts`) exercise the real pipeline.
 *
 * Env is injected here so `src/lib/env.ts` validates cleanly. DATABASE_URL points
 * at the fixed-port throwaway container — never a real Supabase project.
 */
export default defineConfig({
  resolve: {
    alias: { '~': srcDir },
  },
  test: {
    globalSetup: ['./test/global-setup.ts'],
    // Integration tests share one database; run files serially to keep state
    // deterministic (each file resets the tables it uses).
    fileParallelism: false,
    env: {
      DATABASE_URL:
        'postgresql://postgres:postgres@127.0.0.1:54329/autoform_test',
      ENCRYPTION_KEY: randomBytes(32).toString('base64'),
      BETTER_AUTH_SECRET: 'test-better-auth-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
    },
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
})
