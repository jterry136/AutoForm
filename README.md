# AutoForm

A lightweight, free, open-source **form-to-webhook bridge**: drop a simple HTML form onto
any site and have submissions reliably routed to Slack, Airtable, email, or any webhook —
with no backend on your side.

> **Status:** early development. Building **Phase 0 (MVP)** — see [MVP.md](MVP.md). Full
> spec in [REQUIREMENTS.md](REQUIREMENTS.md); architecture and conventions in
> [CLAUDE.md](CLAUDE.md); design decisions in [DECISIONS.md](DECISIONS.md).

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
| `npm run lint` | Lint with ESLint |
| `npm run format` | Format with Prettier |
| `npm run db:generate` | Generate a Drizzle migration from the schema |
| `npm run db:migrate` | Apply migrations to the database |
| `npm run db:studio` | Open Drizzle Studio |

### Database (Supabase)

The Supabase project connection is wired but not yet provisioned. Set `DATABASE_URL` in
`.env` to your Supabase **Transaction pooler** connection string
(Dashboard → Project → Connect → ORMs / Drizzle). The Drizzle client is configured with
`prepare: false` for pooler compatibility.

## License

[MIT](LICENSE).

## About

AutoForm is built and maintained in the open. Learn more about the maintainer and other
projects at **[maintainer portfolio — TODO: add URL](https://example.com)**.
