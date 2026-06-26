# Form fields — definition, HTML, and shadcn/ui

AutoForm validates every submission against a **form definition** (see
[DECISIONS.md](../DECISIONS.md) D-001, D-005). The edge is permissive — you can write any
HTML you like — but once a submission reaches AutoForm it is **normalized** to each
field's expected type and then **validated** against the definition. Fields not in the
definition are rejected with *"this field doesn't match AutoForm's schema definitions."*

The contract is simple: **each input's `name` must match a field `name` in the
definition**, and its values must satisfy that field's type. This page documents how each
field type maps to plain HTML, and which shadcn/ui component to use when you build the
form in React.

## Rules that apply to every field

- **`name` is the contract.** The HTML `name` attribute must equal the definition field's
  `name`. Labels are for humans; names are for routing and validation.
- **Reserved names start with `_`.** `_redirect` (post-submit redirect target) and
  `_gotcha` (spam honeypot) are control fields — never declare them in your definition.
  Any `_`-prefixed field is stripped before validation and never stored.
- **Unknown fields are rejected.** Send only fields the definition declares (plus reserved
  control fields).
- **Whitespace is trimmed** on text-like fields; empty values are treated as "not
  provided" (and fail `required`).

## Field types

| Type | Value after normalization | Plain HTML | shadcn/ui |
|---|---|---|---|
| `text` | trimmed string (`maxLength?`) | `<input type="text" name="…">` | `Input` |
| `email` | valid email string | `<input type="email" name="…">` | `Input type="email"` |
| `phone` | phone-character string | `<input type="tel" name="…">` | `Input type="tel"` |
| `textarea` | trimmed string (`maxLength?`) | `<textarea name="…">` | `Textarea` |
| `number` | number (`min?`/`max?`) | `<input type="number" name="…">` | `Input type="number"` |
| `select` | one of `options` | `<select name="…">` | `Select` |
| `radio` | one of `options` | `<input type="radio" name="…">` group | `RadioGroup` |
| `checkbox` | boolean | single `<input type="checkbox" name="…">` | `Checkbox` |
| `multiselect` | array of `options` | repeated `name` (see below) | `Checkbox` group / multi-`Combobox` |

### Single checkbox (boolean)

A lone checkbox is a boolean. Checked submits a truthy value; unchecked submits nothing
(normalized to `false`). For a **required** checkbox (e.g. "I accept the terms"), the user
must check it.

```html
<label><input type="checkbox" name="agree" value="yes"> I accept the terms</label>
```

### Multi-value inputs (`multiselect`) — the standard

Multiple values for one field use the **same `name`, repeated** — no `[]` brackets. This
is standard HTML behavior and how AutoForm expects arrays.

```html
<!-- checkbox group: all share name="interests" -->
<fieldset>
  <legend>Interests</legend>
  <label><input type="checkbox" name="interests" value="design"> Design</label>
  <label><input type="checkbox" name="interests" value="eng"> Engineering</label>
  <label><input type="checkbox" name="interests" value="sales"> Sales</label>
</fieldset>

<!-- or a multi-select -->
<select name="interests" multiple>
  <option value="design">Design</option>
  <option value="eng">Engineering</option>
  <option value="sales">Sales</option>
</select>
```

Checking Design + Engineering submits `interests=design&interests=eng`, which AutoForm
normalizes to `["design", "eng"]`. Every value must be one of the field's `options`.

> Do **not** use `name="interests[]"`. AutoForm keys on the literal `name`, so brackets
> would create a field named `interests[]` that isn't in your definition.

## Building forms with shadcn/ui

shadcn/ui is the recommended way to build AutoForm forms in React: its components are
pre-assembled, accessible, and themeable, and they emit standard form semantics — so the
**same definition and `name` contract apply unchanged**. Prefer a shadcn component over
hand-rolled markup wherever one exists (see [DECISIONS.md](../DECISIONS.md) D-003).

Add components with the CLI:

```bash
npx shadcn@latest add input textarea select checkbox radio-group label
```

Mapping:

- **text / email / phone / number** → [`Input`](https://ui.shadcn.com/docs/components/input)
  with the matching `type` and a `name`.
- **textarea** → [`Textarea`](https://ui.shadcn.com/docs/components/textarea).
- **select** → [`Select`](https://ui.shadcn.com/docs/components/select). Ensure the
  selected value is submitted under the field `name` (use a native `<select name>` or a
  hidden input bound to the Select's value).
- **radio** → [`RadioGroup`](https://ui.shadcn.com/docs/components/radio-group) with one
  `RadioGroupItem` per option, sharing the field `name`.
- **checkbox (boolean)** → [`Checkbox`](https://ui.shadcn.com/docs/components/checkbox).
- **multiselect** → a **group of `Checkbox`es that submit the same `name`**, or a
  multi-select Combobox — as long as each selected value is posted under the shared field
  `name`.

> Note: some shadcn primitives (`Select`, `Checkbox`, `RadioGroup`) are styled wrappers
> over Radix and don't always emit a native form value by themselves. When using the no-JS
> (action-attribute) embed tier, back them with a native input/`name` (or a hidden input)
> so the value is included in the POST. The JS-snippet tier (Phase 1) will handle this for
> you.
