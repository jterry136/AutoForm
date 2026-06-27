# Test Plan: Destination Configuration & Routing

| | |
|---|---|
| **Test Plan ID** | TP-003 |
| **Feature / Area** | Form destinations — add/validate/delete webhook & email |
| **Related user story / requirement** | USERSTORIES.md #1/#3, FR-DEL-3, FR-CON-2/3/6, P-2 |
| **Author** | AutoForm Team |
| **Created** | 2026-06-25 |
| **Last updated** | 2026-06-25 |
| **Version** | 1.0 |
| **Status** | Ready |

---

## 1. Objective

Verify that a form owner can add webhook and email destinations, that invalid configuration is
rejected at setup time, that a form can hold multiple destinations, and that destinations can be
removed.

## 2. Scope

**In scope**
- Adding webhook and email destinations, setup-time validation, multiple destinations, deletion.

**Out of scope**
- Actual delivery of a submission (TP-004), spam handling (TP-005).

## 3. Test environment

| Item | Value |
|---|---|
| Build / branch / URL | `<main @ commit ____, http://localhost:3000>` |
| Browser(s) / OS | `<e.g. Chrome / Windows 11>` |
| Test account(s) | A signed-in test account that owns a form |
| Database state | App connected to a migrated database |
| External integrations | A webhook sink URL (e.g. https://webhook.site). **Email tests require `RESEND_API_KEY` set on the server** — the email connector validates the key at setup time. |

## 4. Preconditions

- [ ] Signed in, with at least one form created (see TP-002).
- [ ] You are on that form's detail page (`/dashboard/forms/<id>`).
- [ ] A webhook sink URL is available.

## 5. Test data

| Name | Value |
|---|---|
| Webhook name | `My webhook` |
| Webhook URL (valid) | `<your webhook sink URL, e.g. https://webhook.site/xxxx>` |
| Webhook URL (invalid) | `not-a-url` |
| Bearer token (optional) | `secret-token-123` |
| Email name | `My inbox` |
| Email recipient | `you@example.com` |

---

## 6. Test cases

### TC-003.1 — Add a webhook destination (valid)

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | On a form's detail page |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | In the **Destinations** card, click **Add**. | A dialog opens with a Type selector (Webhook/Email) and a Name field. | | ⬜ Pass / Fail |
| 2 | Choose **Webhook**, enter the name and the valid sink URL; leave Bearer token blank; submit. | A success confirmation appears; the destination is listed with type "webhook". | | ⬜ Pass / Fail |
| 3 | Return to the forms list. | The form's **Destinations** count increased by 1. | | ⬜ Pass / Fail |

**Overall expected outcome:** A webhook destination is added to the form.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-003.2 — Reject an invalid webhook URL

| | |
|---|---|
| **Priority** | High |
| **Type** | Error handling |
| **Preconditions** | On a form's detail page |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Open **Add**, choose Webhook, enter a name, and submit with the URL field empty. | The form blocks submission / the destination is rejected (a URL is required). | | ⬜ Pass / Fail |
| 2 | Enter the invalid URL `not-a-url` and submit. | An error indicates the URL must be a valid http(s) URL; no destination is added. | | ⬜ Pass / Fail |

**Overall expected outcome:** Invalid webhook configuration is rejected at setup time.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-003.3 — Add a webhook with a secret (encryption)

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Happy path / security |
| **Preconditions** | On a form's detail page |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Add a webhook destination and enter a **Bearer token**; submit. | The destination is added successfully. | | ⬜ Pass / Fail |
| 2 | Reopen the form detail page and inspect the destination. | The secret is **not** displayed back in plaintext (only an indication that a credential is set, if any). | | ⬜ Pass / Fail |

**Overall expected outcome:** Secrets are accepted but never surfaced back to the browser.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-003.4 — Add an email destination

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | `RESEND_API_KEY` is configured on the server |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Open **Add**, choose **Email**, enter a name and a recipient address; submit. | A success confirmation appears; the destination is listed with type "email". | | ⬜ Pass / Fail |
| 2 | (If `RESEND_API_KEY` is **not** set) Attempt the same. | The destination is rejected with a message that the email provider isn't configured. | | ⬜ Pass / Fail |

**Overall expected outcome:** An email destination is added when the provider is configured, and rejected otherwise.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-003.5 — Multiple destinations and deletion

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Happy path |
| **Preconditions** | At least one destination exists |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Confirm the form has two or more destinations listed. | All configured destinations appear together. | | ⬜ Pass / Fail |
| 2 | Click the **remove** (trash) control on one destination. | A success confirmation appears; that destination disappears from the list. | | ⬜ Pass / Fail |
| 3 | Refresh the page. | The removed destination stays gone; the others remain. | | ⬜ Pass / Fail |

**Overall expected outcome:** A form supports multiple destinations, and they can be removed independently.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

## 7. Results summary

| Test case | Title | Result | Notes |
|---|---|---|---|
| TC-003.1 | Add webhook (valid) | ⬜ Pass / Fail / Blocked | |
| TC-003.2 | Reject invalid webhook URL | ⬜ Pass / Fail / Blocked | |
| TC-003.3 | Webhook secret encryption | ⬜ Pass / Fail / Blocked | |
| TC-003.4 | Add email destination | ⬜ Pass / Fail / Blocked | |
| TC-003.5 | Multiple destinations & deletion | ⬜ Pass / Fail / Blocked | |

**Run summary:** `<X passed, Y failed, Z blocked>` — tested by `<name>` on `<YYYY-MM-DD>`.

## 8. Defects & observations

| ID | Severity | Test case | Description | Issue link |
|---|---|---|---|---|
| — | — | — | _None recorded — log issues here during execution._ | — |

## 9. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Tester | `<name>` | `<YYYY-MM-DD>` | ⬜ Pass ⬜ Fail |
| Reviewer | `<name>` | `<YYYY-MM-DD>` | ⬜ Approved ⬜ Changes requested |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-06-25 | AutoForm Team | Initial draft. |
