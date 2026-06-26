import type { FieldDefinition, FormDefinition } from '~/lib/validation'

/**
 * Universal (action-attribute) embed generation (FR-EMB-1, P-4). Produces a plain
 * `<form action=… method="POST">` derived entirely from the form definition (P-1)
 * — no JavaScript required, works anywhere pasted HTML is allowed.
 *
 * Includes a honeypot field (FR-SPAM-1; enforcement is Chunk 7) and, when set, a
 * hidden `_redirect` (FR-EMB-2). Pure and string-only, so it is unit-testable.
 */

export interface EmbedOptions {
  /** Honeypot field name (form.honeypotField, e.g. `_gotcha`). */
  honeypotField: string
  /** When set, a hidden `_redirect` field is included. */
  redirectUrl?: string | null
}

function escAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function attr(name: string, value: string | number): string {
  return ` ${name}="${escAttr(String(value))}"`
}

function control(field: FieldDefinition): string {
  const name = attr('name', field.name)
  const required = field.required ? ' required' : ''

  switch (field.type) {
    case 'textarea': {
      const max =
        field.maxLength !== undefined ? attr('maxlength', field.maxLength) : ''
      return `<textarea${name}${max}${required}></textarea>`
    }
    case 'number': {
      const min = field.min !== undefined ? attr('min', field.min) : ''
      const max = field.max !== undefined ? attr('max', field.max) : ''
      return `<input type="number"${name}${min}${max}${required}>`
    }
    case 'select': {
      const opts = field.options
        .map((o) => `      <option${attr('value', o)}>${escText(o)}</option>`)
        .join('\n')
      return `<select${name}${required}>\n      <option value="">Choose…</option>\n${opts}\n    </select>`
    }
    case 'radio':
      return field.options
        .map(
          (o) =>
            `<label><input type="radio"${name}${attr('value', o)}${required}> ${escText(o)}</label>`,
        )
        .join('\n    ')
    case 'checkbox':
      return `<input type="checkbox"${name}${required}>`
    case 'multiselect':
      // Repeated names → array (D-005). Each option is its own checkbox.
      return field.options
        .map(
          (o) =>
            `<label><input type="checkbox"${name}${attr('value', o)}> ${escText(o)}</label>`,
        )
        .join('\n    ')
    case 'email':
      return `<input type="email"${name}${required}>`
    case 'phone':
      return `<input type="tel"${name}${required}>`
    case 'text': {
      const max =
        field.maxLength !== undefined ? attr('maxlength', field.maxLength) : ''
      return `<input type="text"${name}${max}${required}>`
    }
  }
}

function fieldBlock(field: FieldDefinition): string {
  // Checkbox reads better with the label after the control.
  if (field.type === 'checkbox') {
    return `  <label>${control(field)} ${escText(field.label)}</label>`
  }
  return `  <label>\n    ${escText(field.label)}\n    ${control(field)}\n  </label>`
}

export function generateEmbedHtml(
  endpoint: string,
  definition: FormDefinition,
  options: EmbedOptions,
): string {
  const fields = definition.fields.map(fieldBlock).join('\n')

  const honeypot =
    `  <!-- Anti-spam: leave empty. Hidden from people, tempting to bots. -->\n` +
    `  <div style="position:absolute;left:-9999px" aria-hidden="true">\n` +
    `    <label>Leave this field empty\n` +
    `      <input type="text"${attr('name', options.honeypotField)} tabindex="-1" autocomplete="off">\n` +
    `    </label>\n` +
    `  </div>`

  const redirect = options.redirectUrl
    ? `\n  <input type="hidden" name="_redirect"${attr('value', options.redirectUrl)}>`
    : ''

  return [
    `<form action="${escAttr(endpoint)}" method="POST">`,
    fields,
    honeypot + redirect,
    `  <button type="submit">Send</button>`,
    `</form>`,
  ].join('\n')
}
