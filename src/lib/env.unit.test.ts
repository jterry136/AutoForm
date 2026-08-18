import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import { ENV_VARS, envSchema } from '~/lib/env'

/**
 * Environment-variable parity (FR-DOC-6, D-014).
 *
 * Three things must describe the same set of variables with the same
 * requiredness: the ArkType schema in `src/lib/env.ts` (the contract), the
 * `.env.example` template, and the reference table in `docs/configuration.md`.
 * `ENV_VARS` is the shared list; these tests fail when any of the three drifts.
 */

function repoFile(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../${relative}`, import.meta.url)),
    'utf8',
  )
}

/** Assignment keys in `.env.example`, ignoring comments and blank lines. */
function envExampleKeys(): string[] {
  return repoFile('.env.example')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim())?.[1])
    .filter((name): name is string => name !== undefined)
}

/** Variables listed in the `docs/configuration.md` reference table. */
function documentedVars(): { name: string; required: boolean }[] {
  return repoFile('docs/configuration.md')
    .split('\n')
    .map((line) => /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*([^|]+)\|/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({
      name: match[1]!,
      required: /yes/i.test(match[2]!),
    }))
}

/** A complete environment: every known variable present with a valid sample. */
function completeEnv(): Record<string, string> {
  return Object.fromEntries(ENV_VARS.map((v) => [v.name, v.sample]))
}

/** A complete environment minus one variable. */
function envWithout(name: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(completeEnv()).filter(([key]) => key !== name),
  )
}

const names = ENV_VARS.map((v) => v.name)
const required = ENV_VARS.filter((v) => v.required)
const optional = ENV_VARS.filter((v) => !v.required)

describe('env — schema ↔ ENV_VARS parity', () => {
  it('accepts an environment holding exactly the documented variables', () => {
    // Fails if the schema requires something ENV_VARS does not list.
    expect(envSchema(completeEnv())).not.toBeInstanceOf(type.errors)
  })

  it.each(required.map((v) => v.name))('requires %s', (name) => {
    expect(envSchema(envWithout(name))).toBeInstanceOf(type.errors)
  })

  it.each(optional.map((v) => v.name))('treats %s as optional', (name) => {
    expect(envSchema(envWithout(name))).not.toBeInstanceOf(type.errors)
  })

  it('rejects a required variable set to an empty string', () => {
    expect(envSchema({ ...completeEnv(), DATABASE_URL: '' })).toBeInstanceOf(
      type.errors,
    )
  })

  it('ignores unrelated variables in the process environment', () => {
    const withNoise = { ...completeEnv(), PATH: '/usr/bin', HOME: '/root' }
    expect(envSchema(withNoise)).not.toBeInstanceOf(type.errors)
  })

  it('describes what breaks for every variable', () => {
    for (const v of ENV_VARS) expect(v.summary.length).toBeGreaterThan(0)
  })
})

describe('env — .env.example parity', () => {
  it('templates every known variable, and nothing unknown', () => {
    expect(envExampleKeys().sort()).toEqual([...names].sort())
  })

  it('commits no values for secret variables', () => {
    const secrets = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ENCRYPTION_KEY']
    for (const line of repoFile('.env.example').split('\n')) {
      const [name, ...rest] = line.trim().split('=')
      if (name && secrets.includes(name)) expect(rest.join('=')).toBe('')
    }
  })
})

describe('env — docs/configuration.md parity', () => {
  it('documents every known variable, and nothing unused', () => {
    expect(
      documentedVars()
        .map((v) => v.name)
        .sort(),
    ).toEqual([...names].sort())
  })

  it('states requiredness consistently with the schema', () => {
    const documented = new Map(
      documentedVars().map((v) => [v.name, v.required]),
    )
    for (const v of ENV_VARS) expect(documented.get(v.name)).toBe(v.required)
  })

  it('gives each variable its own section', () => {
    const doc = repoFile('docs/configuration.md')
    for (const name of names) expect(doc).toContain(`### \`${name}\``)
  })
})
