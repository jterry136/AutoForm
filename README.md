# AutoForm

A lightweight, free, open-source **form-to-webhook bridge**: drop a simple HTML form onto
any site and have submissions reliably routed to Slack, Airtable, email, or any webhook —
with no backend on your side.

> **Status:** Phase 0 (MVP) core is in place — submission ingestion, asynchronous delivery
> with retries and dead-lettering, webhook + email connectors, a dashboard, and the
> universal (no-JS) embed tier. See [MVP.md](MVP.md). Full spec in
> [REQUIREMENTS.md](REQUIREMENTS.md); architecture and conventions in
> [CLAUDE.md](CLAUDE.md); design decisions in [DECISIONS.md](DECISIONS.md).

**New here? Start with the [getting-started guide](docs/getting-started.md).**

## Tech stack

- **[TanStack Start](https://tanstack.com/start)** — full-stack React (routing, server
  routes, server functions)
- **[ArkType](https://arktype.io)** — schema validation
- **[shadcn/ui](https://ui.shadcn.com)** + **[Lucide](https://lucide.dev)** — UI and icons
- **Supabase Postgres** + **[Drizzle ORM](https://orm.drizzle.team)** — storage
- **[Better Auth](https://better-auth.com)** — authentication
- **[Resend](https://resend.com)** — transactional email connector

## Getting started

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env   # then fill in DATABASE_URL etc.

# 3. Run the dev server (http://localhost:3000)
npm run dev
```

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start the dev server on port 3000 |
| `npm run build` | Production build |
| `npm start` | Run the production server |
| `npm run typecheck` | Type-check with TypeScript |
| `npm test` | Run the test suite (Vitest; integration tests use an ephemeral Postgres via Docker) |
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply migrations to the database |
| `npm run db:studio` | Open Drizzle Studio |

### Environment

Copy `.env.example` to `.env` and set:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Supabase Postgres connection — use the **Transaction pooler** URL (Dashboard → Project → Connect → ORMs / Drizzle). |
| `BETTER_AUTH_SECRET` | Auth signing secret (`openssl rand -base64 32`). |
| `BETTER_AUTH_URL` | App base URL (e.g. `http://localhost:3000`). |
| `ENCRYPTION_KEY` | 32-byte, base64-encoded key for destination-credential encryption. |
| `RESEND_API_KEY` | Resend API key for the email connector (optional until you use email). |

`.env` is loaded into the dev server automatically; the Drizzle client uses `prepare: false`
for Supabase pooler compatibility. Apply the schema with `npm run db:migrate`.

## Documentation

- [Getting started](docs/getting-started.md) — zero to a live, delivering form.
- [Form fields](docs/form-fields.md) — the form-definition reference (types, HTML, shadcn/ui).
- [Connectors](docs/connectors.md) — webhook and email configuration.

## License

[MIT](LICENSE).

## About

AutoForm is built and maintained in the open. Learn more about the maintainer and other
projects at **[maintainer portfolio — TODO: add URL](https://example.com)**.
