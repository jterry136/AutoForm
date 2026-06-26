import { type } from 'arktype'

/**
 * The canonical form definition (P-1) and the engine that validates submissions
 * against it (D-001, D-002). ArkType is the one source of truth for shape and
 * validation; the rendered form, embed code, and routing all derive from a
 * definition.
 *
 * Two-step contract (D-005): the edge is permissive, but once a submission
 * crosses `submit` it is (1) NORMALIZED — raw urlencoded/JSON values coerced to
 * the field's expected runtime type — then (2) VALIDATED against the definition.
 * Anything outside the schema is rejected as wrong.
 */

// ─── Form-definition meta-schema (validates a stored definition) ─────────────

// Field names map to HTML input `name`s. Must start with a letter and may not
// begin with `_` (reserved for control fields like `_redirect`, `_gotcha`).
const fieldName = type(/^[a-zA-Z][a-zA-Z0-9_-]*$/)
const nonEmptyStrings = type('string').array().atLeastLength(1)

const base = {
  name: fieldName,
  label: 'string >= 1',
  'required?': 'boolean',
} as const

const textField = type({ ...base, type: "'text'", 'maxLength?': 'number > 0' })
const emailField = type({ ...base, type: "'email'" })
const phoneField = type({ ...base, type: "'phone'" })
const textareaField = type({
  ...base,
  type: "'textarea'",
  'maxLength?': 'number > 0',
})
const numberField = type({
  ...base,
  type: "'number'",
  'min?': 'number',
  'max?': 'number',
})
const selectField = type({
  ...base,
  type: "'select'",
  options: nonEmptyStrings,
})
const radioField = type({ ...base, type: "'radio'", options: nonEmptyStrings })
const checkboxField = type({ ...base, type: "'checkbox'" })
const multiselectField = type({
  ...base,
  type: "'multiselect'",
  options: nonEmptyStrings,
})

const fieldSchema = textField
  .or(emailField)
  .or(phoneField)
  .or(textareaField)
  .or(numberField)
  .or(selectField)
  .or(radioField)
  .or(checkboxField)
  .or(multiselectField)

export const formDefinitionSchema = type({
  version: '1',
  fields: fieldSchema.array().atLeastLength(1),
}).narrow((def, ctx) => {
  const names = def.fields.map((f) => f.name)
  if (new Set(names).size !== names.length) {
    return ctx.mustBe('a definition with unique field names')
  }
  return true
})

export type FieldDefinition = typeof fieldSchema.infer
export type FormDefinition = typeof formDefinitionSchema.infer

// ─── Reserved control fields ─────────────────────────────────────────────────

export const RESERVED_PREFIX = '_'
/** Post-submission redirect target (FR-EMB-2). */
export const REDIRECT_FIELD = '_redirect'

/** Control fields (`_`-prefixed) are stripped before validation, never stored. */
export function isReservedField(name: string): boolean {
  return name.startsWith(RESERVED_PREFIX)
}

// ─── Submission validation ───────────────────────────────────────────────────

export type SubmissionError = { field: string; message: string }
export type SubmissionResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; errors: SubmissionError[] }

const UNKNOWN_FIELD_MESSAGE =
  "this field doesn't match AutoForm's schema definitions"

function toBoolean(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (raw === undefined || raw === null) return false
  const s = String(raw).trim().toLowerCase()
  return s === 'on' || s === 'true' || s === '1' || s === 'yes'
}

type NormalizeResult = { value?: unknown; error?: string }

/** Coerce a raw value to the field's expected runtime type (step 1). */
function normalizeField(field: FieldDefinition, raw: unknown): NormalizeResult {
  switch (field.type) {
    case 'checkbox': {
      if (Array.isArray(raw)) {
        return { error: `${field.label} does not accept multiple values` }
      }
      return { value: toBoolean(raw) }
    }
    case 'multiselect': {
      const arr = Array.isArray(raw)
        ? raw
        : raw === undefined || raw === null || raw === ''
          ? []
          : [raw]
      const values = arr.map((v) => String(v).trim()).filter((v) => v !== '')
      return { value: values }
    }
    case 'number': {
      if (Array.isArray(raw)) {
        return { error: `${field.label} does not accept multiple values` }
      }
      if (raw === undefined || raw === null || raw === '') {
        return { value: undefined }
      }
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (Number.isNaN(n)) return { error: `${field.label} must be a number` }
      return { value: n }
    }
    default: {
      // text, email, phone, textarea, select, radio → scalar string.
      if (Array.isArray(raw)) {
        return { error: `${field.label} does not accept multiple values` }
      }
      if (raw === undefined || raw === null) return { value: undefined }
      const s = String(raw).trim()
      return { value: s === '' ? undefined : s }
    }
  }
}

/** Build the ArkType validator for a field's coerced VALUE (step 2). */
function buildFieldValidator(field: FieldDefinition) {
  switch (field.type) {
    case 'text':
    case 'textarea':
      if (field.maxLength !== undefined) {
        return field.required
          ? type(`1 <= string <= ${field.maxLength}`)
          : type(`string <= ${field.maxLength}`)
      }
      return field.required ? type('string >= 1') : type('string')
    case 'email':
      return type('string.email')
    case 'phone':
      return type(/^[+0-9().\s-]{7,20}$/)
    case 'number': {
      const { min, max } = field
      if (min !== undefined && max !== undefined) {
        return type(`${min} <= number <= ${max}`)
      }
      if (min !== undefined) return type(`number >= ${min}`)
      if (max !== undefined) return type(`number <= ${max}`)
      return type('number')
    }
    case 'select':
    case 'radio':
      return type.enumerated(...field.options)
    case 'checkbox':
      return field.required ? type('true') : type('boolean')
    case 'multiselect': {
      const each = type.enumerated(...field.options).array()
      return field.required ? each.atLeastLength(1) : each
    }
  }
}

/**
 * Validate a raw submission against its form definition. Reserved (`_`-prefixed)
 * fields must be stripped by the caller before this point; any other key not in
 * the definition is rejected (D-001).
 */
export function validateSubmission(
  definition: FormDefinition,
  raw: Record<string, unknown>,
): SubmissionResult {
  const errors: SubmissionError[] = []
  const fieldNames = new Set(definition.fields.map((f) => f.name))

  // Reject unknown fields (ignoring reserved control fields).
  for (const key of Object.keys(raw)) {
    if (isReservedField(key)) continue
    if (!fieldNames.has(key)) {
      errors.push({ field: key, message: UNKNOWN_FIELD_MESSAGE })
    }
  }

  const data: Record<string, unknown> = {}
  for (const field of definition.fields) {
    const normalized = normalizeField(field, raw[field.name])
    if (normalized.error) {
      errors.push({ field: field.name, message: normalized.error })
      continue
    }

    const value = normalized.value
    if (value === undefined) {
      if (field.required) {
        errors.push({
          field: field.name,
          message: `${field.label} is required`,
        })
      }
      continue
    }

    data[field.name] = value
    const out = buildFieldValidator(field)(value)
    if (out instanceof type.errors) {
      errors.push({
        field: field.name,
        message: `${field.label}: ${out.summary}`,
      })
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, data }
}
