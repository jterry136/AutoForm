---
name: New connector
about: Propose a new destination connector (Slack, Airtable, CRM, custom API, …)
title: 'Connector: <destination>'
labels: ['enhancement', 'connector']
---

## Destination

<!-- What service does this connector deliver submissions to? Link its API docs. -->

## Config shape

<!-- What per-destination settings does it need? Which are required vs optional? -->

| Field | Required | Notes |
|---|---|---|
| | | |

## Auth / secrets

<!--
How does it authenticate? Per-destination credential (encrypted at rest, P-2) or an
app-level secret in `~/lib/env.ts`? Confirm nothing must reach the client.
-->

## Delivery & retries

<!--
What request does `deliver` make? Which failures are transient (retryable) vs permanent?
Any rate limits to respect?
-->

## Sanitization (NFR-SEC-3)

<!-- What injection vectors does this destination have (headers, markup, mentions)? -->

## Free-tier check (C-1)

<!-- Confirm the connector works against the destination's free tier. -->

---

Implementation follows the connector pathway: copy `src/connectors/_template.ts` and
`src/connectors/_template.unit.test.ts`, then work the checklist in `docs/connectors.md`.
