# Getting started

Go from zero to a live, delivering form in a few minutes (FR-DOC-1). This walks through
the real dashboard flow.

> **What AutoForm does:** you get a public endpoint per form. Point any HTML form at it;
> AutoForm validates and spam-filters each submission, stores it, and delivers it to your
> destinations (webhook, email) — no backend on your side.

## 1. Create an account

Open the app, go to **Sign up** (`/signup`), and create an account with email + password.
You'll land on the dashboard (`/dashboard`).

## 2. Create a form

Click **New form**. Give it a name and a **form definition** — the canonical schema every
submission is validated against (it's mandatory; see
[DECISIONS.md](../DECISIONS.md) D-001). The dialog starts you with:

```json
{
  "version": 1,
  "fields": [
    { "name": "email", "label": "Email", "type": "email", "required": true },
    { "name": "message", "label": "Message", "type": "textarea" }
  ]
}
```

Edit the fields to match your form. See the [form fields reference](form-fields.md) for every
field type and option. Click **Create form**.

## 3. Add a destination

Open the form and, under **Destinations**, click **Add**. Choose:

- **Webhook** — POSTs the submission as JSON to a URL you control.
- **Email** — emails the submission to one or more addresses (requires `RESEND_API_KEY` on
  the server).

See [connectors.md](connectors.md) for each connector's config. A form can have several
destinations; without any, submissions are still stored — just not delivered.

## 4. Put the form on your site

You have two options.

### Option A — copy the generated embed (recommended)

The form detail page has an **Embed code** card: a plain `<form action=… method="POST">`
with all your fields, a spam honeypot, and a submit button. Copy it and paste it into any
page that allows HTML. No JavaScript required.

### Option B — bring your own HTML

Point your existing form's `action` at the endpoint shown on the form page:

```html
<form action="https://YOUR-HOST/f/f_yourPublicId" method="POST">
  <input type="email" name="email" required />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>
```

The endpoint accepts both `application/x-www-form-urlencoded` and `application/json`.
**Field names must match your definition** — anything outside the schema is rejected
(D-001). Optional control fields:

- `_redirect` (hidden) — where to send the browser after a successful no-JS submit. Without
  it, AutoForm shows its hosted success page (`/success`).
- the honeypot field (default `_gotcha`) — include it as an off-screen input to catch bots.

## 5. Submit and watch it deliver

Submit the form. On the form page, the **Inbox** shows the stored submission with a delivery
badge: **Delivered**, **Pending**, **Partial**, or **Failed**. Delivery happens
asynchronously with automatic retries and dead-lettering, so a temporarily down destination
won't lose anything.

## 6. Export your submissions

On the form page, the **Inbox** card has an **Export** button: open it and pick **Export
CSV** or **Export JSON**. The file downloads as an attachment named
`<form-name>-submissions-<date>.csv` (or `.json`). The button is disabled until the form has
at least one submission.

The same download is a plain authenticated URL, so you can script it with your session
cookie:

```
GET /api/forms/{formId}/export?format=csv     # or format=json (default: csv)
```

`formId` is the form's dashboard ID (the one in the dashboard URL), **not** the public ID
used by the embed. The download requires a signed-in session and only ever returns forms you
own — a form belonging to someone else responds exactly like one that doesn't exist.

### What's in the file

Three fixed metadata columns come first, then one column per field:

| Column | Meaning |
| --- | --- |
| `submission_id` | The submission's ID. |
| `submitted_at` | When it was received, ISO-8601 UTC. |
| `delivery_status` | Rolled-up delivery state: `delivered`, `pending`, `partial`, `failed`, or `none`. |
| …form fields | One column per field in the **form definition**, in definition order. |

Every defined field gets a column even if no exported submission filled it — the file's
shape belongs to the form, not to whichever rows you happened to download. Keys a BYO form
submitted that aren't in the definition are appended after the defined ones, sorted
alphabetically so the header is stable between exports.

In CSV, values that aren't plain text (a multi-select, say) are written as JSON —
`["a","b"]`. In JSON, they stay structured: the export is an array of
`{ id, submittedAt, deliveryStatus, payload }` objects, with `payload` keyed in the same
column order.

**Spreadsheet formula guard.** Submissions are attacker-controlled text, so any CSV value
starting with `=`, `+`, `-`, `@`, a tab, or a carriage return is prefixed with a single
quote (`'`). Excel, Sheets, and LibreOffice then show it as text instead of running it as a
formula. That leading `'` is not part of the submitted data — the JSON export has the raw
value if you need it verbatim.

**Export size.** An export is built in memory, so it is capped at the **10,000 most recent
submissions** per form. When a form has more, the file still downloads and the response
carries `X-Export-Truncated: true` alongside `X-Export-Row-Limit`. Every response reports its
row count in `X-Export-Row-Count`.

## Running AutoForm locally

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY, RESEND_API_KEY
npm run db:migrate       # apply the schema to your database
npm run dev              # http://localhost:3000
```

See the [README](../README.md) for the full environment and command reference, and
[CLAUDE.md](../CLAUDE.md) for architecture and conventions.
