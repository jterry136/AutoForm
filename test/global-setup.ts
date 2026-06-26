import { execFileSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'

/**
 * Vitest globalSetup: spin up a throwaway Postgres in Docker, apply the project's
 * migrations to it (which also validates that SQL), and tear it down afterward.
 * Uses a fixed port + name so the DATABASE_URL in vitest.config.ts is stable. It
 * never touches a real Supabase project.
 */

const CONTAINER = 'autoform-test-pg'
const PORT = 54329
const DB_URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/autoform_test`

function docker(args: string[], opts: { allowFail?: boolean } = {}): string {
  try {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    if (opts.allowFail) return ''
    throw err
  }
}

export default async function setup(): Promise<() => Promise<void>> {
  try {
    docker(['info'])
  } catch {
    throw new Error(
      'Docker daemon is not reachable. Start Docker Desktop and re-run `npm test`.',
    )
  }

  // Fresh container every run.
  docker(['rm', '-f', CONTAINER], { allowFail: true })
  docker([
    'run',
    '-d',
    '--name',
    CONTAINER,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_DB=autoform_test',
    '-p',
    `${PORT}:5432`,
    'postgres:16-alpine',
  ])

  // Wait for the server to report ready.
  const readyBy = Date.now() + 60_000
  for (;;) {
    try {
      docker([
        'exec',
        CONTAINER,
        'pg_isready',
        '-U',
        'postgres',
        '-d',
        'autoform_test',
      ])
      break
    } catch {
      if (Date.now() > readyBy) {
        throw new Error('Postgres did not become ready within 60s.')
      }
      await sleep(1000)
    }
  }

  const sql = postgres(DB_URL, { max: 1 })
  try {
    // pg_isready can flip "ready" a moment before the socket truly accepts.
    for (let i = 0; ; i++) {
      try {
        await sql`select 1`
        break
      } catch (err) {
        if (i >= 20) throw err
        await sleep(500)
      }
    }
    await migrate(drizzle(sql), { migrationsFolder: 'src/db/migrations' })
  } finally {
    await sql.end({ timeout: 5 })
  }

  return async () => {
    docker(['rm', '-f', CONTAINER], { allowFail: true })
  }
}
