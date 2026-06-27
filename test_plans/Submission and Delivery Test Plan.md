# Test Plan: End-to-End Submission & Delivery (Universal Embed)

| | |
|---|---|
| **Test Plan ID** | TP-004 |
| **Feature / Area** | Embed generation, ingestion, async delivery, inbox |
| **Related user story / requirement** | USERSTORIES.md #1/#3, FR-EMB-1/2, FR-ING-1/2/3/4, FR-DEL-1/2, FR-SUB-2 |
| **Author** | AutoForm Team |
| **Created** | 2026-06-25 |
| **Last updated** | 2026-06-25 |
| **Version** | 1.0 |
| **Status** | Ready |

---

## 1. Objective

Verify the core promise: a user copies the generated embed, a visitor submits it with no
JavaScript, the submission is stored and delivered to a destination, and the owner sees it in
the inbox with a delivery status.

## 2. Scope

**In scope**
- Copying the universal `<form>` embed, submitting it (no-JS redirect path and JSON/AJAX path),
  the hosted success page and `_redirect`, delivery to a webhook, and the inbox status.

**Out of scope**
- Spam/validation rejection (TP-005), email provider specifics (TP-003), iframe/JS tiers (Phase 1).

## 3. Test environment

| Item | Value |
|---|---|
| Build / branch / URL | `<main @ commit ____, http://localhost:3000>` |
| Browser(s) / OS | `<e.g. Chrome / Windows 11>` |
| Test account(s) | A signed-in account that owns a form |
| Database state | App connected to a migrated database; delivery worker running |
| External integrations | A webhook sink (e.g. https://webhook.site) to receive deliveries |
| Tools | A plain text editor to save an HTML file; optionally `curl` for the AJAX case |

## 4. Preconditions

- [ ] A form exists with fields `email` (required) and `message` (see TP-002).
- [ ] The form has a **webhook** destination pointing at your sink (see TP-003).
- [ ] You have the form's detail page open and the sink page open in another tab.

## 5. Test data

| Name | Value |
|---|---|
| Valid submission | email = `visitor@example.com`, message = `Hello there` |
| Endpoint URL | `<copied from the form's Endpoint card>` |
| Sink URL | `<your webhook sink>` |

---

## 6. Test cases

### TC-004.1 — Copy and inspect the embed code

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path / UI |
| **Preconditions** | On the form detail page |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Locate the **Embed code** card and click **Copy**. | A confirmation appears that the embed code was copied. | | ⬜ Pass / Fail |
| 2 | Paste the code into a text editor and review it. | It's a `<form action="…/f/f_…" method="POST">` containing an input per field, a submit button, and an off-screen honeypot field. | | ⬜ Pass / Fail |

**Overall expected outcome:** A ready-to-paste, no-JS form is generated from the definition.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-004.2 — Submit the embed (no-JS) and land on success

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | Embed code copied (TC-004.1) |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Save the copied code into an `.html` file and open it in a browser (with JavaScript disabled or simply as a plain page). | The form renders with your fields and a submit button. | | ⬜ Pass / Fail |
| 2 | Fill in a valid email and message; submit. | The browser navigates to the hosted **success page** (`/success`) showing a confirmation. | | ⬜ Pass / Fail |
| 3 | Switch to the webhook sink tab. | Within a few seconds, the sink shows a `POST` with a JSON body containing `email` and `message`. | | ⬜ Pass / Fail |

**Overall expected outcome:** A no-JS submission is accepted, the visitor sees success, and the webhook receives the data.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-004.3 — Inbox shows the submission and delivery status

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path / observability |
| **Preconditions** | TC-004.2 completed |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Return to the form's detail page and open the **Inbox**. | The new submission is listed with its received time and data. | | ⬜ Pass / Fail |
| 2 | Check the delivery badge for that row (refresh if needed). | It shows **Delivered** (green). | | ⬜ Pass / Fail |
| 3 | On the forms list, check the form's **Submissions** count. | It increased by 1. | | ⬜ Pass / Fail |

**Overall expected outcome:** The submission is stored and its successful delivery is visible.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-004.4 — Custom redirect via `_redirect`

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Happy path |
| **Preconditions** | Embed code saved locally |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | In the saved HTML, add a hidden field `<input type="hidden" name="_redirect" value="https://example.com/thanks">` inside the form. | (Edit only.) | | ⬜ Pass / Fail |
| 2 | Reload the page, submit valid data. | After submitting, the browser is redirected to `https://example.com/thanks` instead of the default success page. | | ⬜ Pass / Fail |

**Overall expected outcome:** A `_redirect` field overrides the default post-submit destination.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-004.5 — JSON / AJAX submission

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Happy path (developer path) |
| **Preconditions** | Endpoint URL known |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Send a JSON POST to the endpoint, e.g. `curl -X POST <endpoint> -H "content-type: application/json" -d '{"email":"a@b.co","message":"hi"}'`. | The response is `200` with a JSON body indicating success (and an id). | | ⬜ Pass / Fail |
| 2 | Check the inbox. | The submission appears and delivers to the webhook. | | ⬜ Pass / Fail |

**Overall expected outcome:** The endpoint accepts JSON as well as urlencoded form posts.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

## 7. Results summary

| Test case | Title | Result | Notes |
|---|---|---|---|
| TC-004.1 | Copy & inspect embed | ⬜ Pass / Fail / Blocked | |
| TC-004.2 | No-JS submit → success + webhook | ⬜ Pass / Fail / Blocked | |
| TC-004.3 | Inbox shows Delivered | ⬜ Pass / Fail / Blocked | |
| TC-004.4 | `_redirect` override | ⬜ Pass / Fail / Blocked | |
| TC-004.5 | JSON/AJAX submission | ⬜ Pass / Fail / Blocked | |

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
