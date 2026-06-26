import { type } from 'arktype'
import { describe, expect, it } from 'vitest'
import {
  formDefinitionSchema,
  validateSubmission,
  type FormDefinition,
} from '~/lib/validation'

/** Parse a raw definition through the meta-schema, failing the test if invalid. */
function define(raw: unknown): FormDefinition {
  const parsed = formDefinitionSchema(raw)
  if (parsed instanceof type.errors) {
    throw new Error(`fixture definition invalid: ${parsed.summary}`)
  }
  return parsed
}

const sampleDefinition = define({
  version: 1,
  fields: [
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'age', label: 'Age', type: 'number', min: 0, max: 120 },
    { name: 'subscribe', label: 'Subscribe', type: 'checkbox' },
    {
      name: 'topics',
      label: 'Topics',
      type: 'multiselect',
      options: ['a', 'b', 'c'],
    },
    {
      name: 'plan',
      label: 'Plan',
      type: 'select',
      options: ['free', 'pro'],
      required: true,
    },
  ],
})

describe('formDefinitionSchema (D-001/D-005 meta-schema)', () => {
  it('accepts a well-formed definition', () => {
    expect(formDefinitionSchema(sampleDefinition)).not.toBeInstanceOf(
      type.errors,
    )
  })

  it('rejects duplicate field names', () => {
    const out = formDefinitionSchema({
      version: 1,
      fields: [
        { name: 'a', label: 'A', type: 'text' },
        { name: 'a', label: 'A2', type: 'text' },
      ],
    })
    expect(out).toBeInstanceOf(type.errors)
  })

  it('rejects field names starting with the reserved underscore', () => {
    const out = formDefinitionSchema({
      version: 1,
      fields: [{ name: '_secret', label: 'X', type: 'text' }],
    })
    expect(out).toBeInstanceOf(type.errors)
  })

  it('rejects an empty fields array and a non-1 version', () => {
    expect(formDefinitionSchema({ version: 1, fields: [] })).toBeInstanceOf(
      type.errors,
    )
    expect(
      formDefinitionSchema({
        version: 2,
        fields: [{ name: 'a', label: 'A', type: 'text' }],
      }),
    ).toBeInstanceOf(type.errors)
  })
})

describe('validateSubmission — normalize then validate (D-005)', () => {
  it('accepts a valid submission and coerces values to runtime types', () => {
    const result = validateSubmission(sampleDefinition, {
      email: '  user@example.com  ',
      age: '30',
      subscribe: 'on',
      topics: ['a', 'b'],
      plan: 'pro',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toEqual({
        email: 'user@example.com', // trimmed
        age: 30, // coerced to number
        subscribe: true, // 'on' → boolean
        topics: ['a', 'b'],
        plan: 'pro',
      })
    }
  })

  it('rejects unknown fields not in the definition (D-001)', () => {
    const result = validateSubmission(sampleDefinition, {
      email: 'user@example.com',
      plan: 'free',
      surprise: 'nope',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field)
      expect(fields).toContain('surprise')
    }
  })

  it('ignores reserved (_-prefixed) control fields', () => {
    const result = validateSubmission(sampleDefinition, {
      email: 'user@example.com',
      plan: 'free',
      _redirect: '/thanks',
      _gotcha: '',
    })
    expect(result.ok).toBe(true)
  })

  it('requires required fields', () => {
    const result = validateSubmission(sampleDefinition, { plan: 'free' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === 'email')).toBe(true)
    }
  })

  it('rejects a malformed email', () => {
    const result = validateSubmission(sampleDefinition, {
      email: 'not-an-email',
      plan: 'free',
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-numeric number and an out-of-range number', () => {
    expect(
      validateSubmission(sampleDefinition, {
        email: 'u@e.co',
        plan: 'free',
        age: 'abc',
      }).ok,
    ).toBe(false)
    expect(
      validateSubmission(sampleDefinition, {
        email: 'u@e.co',
        plan: 'free',
        age: '999',
      }).ok,
    ).toBe(false)
  })

  it('rejects select/multiselect values outside the allowed options', () => {
    expect(
      validateSubmission(sampleDefinition, {
        email: 'u@e.co',
        plan: 'enterprise',
      }).ok,
    ).toBe(false)
    expect(
      validateSubmission(sampleDefinition, {
        email: 'u@e.co',
        plan: 'free',
        topics: ['z'],
      }).ok,
    ).toBe(false)
  })

  it('rejects multiple values for a scalar field', () => {
    const result = validateSubmission(sampleDefinition, {
      email: ['a@b.co', 'c@d.co'],
      plan: 'free',
    })
    expect(result.ok).toBe(false)
  })

  it('treats a required checkbox left unchecked as invalid', () => {
    const def = define({
      version: 1,
      fields: [
        { name: 'agree', label: 'Agree', type: 'checkbox', required: true },
      ],
    })
    expect(validateSubmission(def, {}).ok).toBe(false)
    expect(validateSubmission(def, { agree: 'on' }).ok).toBe(true)
  })
})
