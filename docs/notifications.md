# Delivery-failure notifications

AutoForm keeps retrying a delivery until it succeeds or runs out of attempts. When it runs
out, the delivery is **dead-lettered** — it will not be retried again on its own. If that
keeps happening, something about the destination is broken (a URL that has moved, a token
that expired, a mailbox that no longer exists), and nobody would find out unless AutoForm
said so.

So it does two things: it flags the destination in your dashboard, and — once — it emails
you.

## When you get an email

A destination is judged healthy or not by a **consecutive dead-letter counter**:

| Behaviour | Default | Env var |
|---|---|---|
| Dead-lettered deliveries in a row before the destination is flagged | `3` | `DELIVERY_HEALTH_THRESHOLD` |
| Minimum gap before the same destination can alert again | `1440` minutes (24h) | `DELIVERY_HEALTH_COOLOFF_MINUTES` |

- A delivery that **failed but still has a retry queued** does not count. Only terminal
  outcomes do — a success or a dead-letter.
- Crossing the threshold sends **one** email, then suppresses further ones for the
  cool-off window. A destination that has been broken for a week emails you once a day,
  not once per submission.
- The suppression is stored in the database, so restarting the server does not re-mail you
  about an outage you already know about.
- The counter is **per destination**. A broken webhook does not mute alerts for a healthy
  email destination on the same form.
- **Any success resets everything** — the counter, the flag, and the cool-off.

## What the email contains

The form name, the destination's name and type, how many deliveries were given up on, when
the last failure was, the connector's own error text (truncated), and a link to the form's
dashboard page.

It contains **no submission data**. The alert describes a destination, never the data that
was being delivered — the internal alert type has no field that could carry a payload, so
this is structural rather than a convention someone has to remember.

Recovery is **not** emailed. When a destination starts working again the dashboard badge
clears, which is the same information without a second message.

## What you see in the dashboard

On the form's page, a flagged destination shows a **Failing** badge and a line explaining
how many deliveries in a row were given up on, when the trouble started, and the last
error. The status is spelled out in words and marked with an icon, not conveyed by colour
alone.

Turning the emails off does not hide this — the dashboard is always accurate.

## Turning the emails off

Each form has a **Delivery failure emails** toggle in its **Destinations** card. Switching
it off stops the mail for that form only; detection, the stored health state, and the
dashboard badge all keep working.

There is no unsubscribe link in the email itself — the notification goes to the form
owner's account address, and the toggle is the owner-authenticated way to turn it off.

## Configuration for self-hosters

Delivery-failure email needs Resend:

| Variable | Required | Purpose |
|---|---|---|
| `RESEND_API_KEY` | for email to send at all | Resend API key. Also used by the email connector. |
| `MAIL_FROM` | no | Sender identity for AutoForm's own mail, e.g. `AutoForm <notifications@example.com>`. Defaults to Resend's onboarding sender, which is only suitable for testing — set this to an address on a domain you have verified with Resend. |
| `BETTER_AUTH_URL` | yes | Used to build the dashboard link in the email. |
| `DELIVERY_HEALTH_THRESHOLD` | no | See the table above. |
| `DELIVERY_HEALTH_COOLOFF_MINUTES` | no | See the table above. |

**With `RESEND_API_KEY` unset, nothing breaks.** Submissions are still accepted, still
delivered, still retried; unhealthy destinations are still flagged in the dashboard. The
email is logged and skipped. The same is true if Resend itself is down or rejects the call
— a notification can never stall or crash the delivery worker, so a dropped alert is
preferred to a stuck queue.

## Related

- [Connectors](connectors.md) — configuring webhook and email destinations.
- [Getting started](getting-started.md) — from zero to a delivering form.
- `DECISIONS.md` D-010 (detection rule) and D-013 (opt-out scope).
