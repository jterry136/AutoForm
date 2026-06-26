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

## Running AutoForm locally

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, BETTER_AUTH_SECRET, ENCRYPTION_KEY, RESEND_API_KEY
npm run db:migrate       # apply the schema to your database
npm run dev              # http://localhost:3000
```

See the [README](../README.md) for the full environment and command reference, and
[CLAUDE.md](../CLAUDE.md) for architecture and conventions.
