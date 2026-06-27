# Test Plan: Spam & Abuse Protection

| | |
|---|---|
| **Test Plan ID** | TP-005 |
| **Feature / Area** | Ingestion guards — honeypot, validation rejection, rate limiting |
| **Related user story / requirement** | FR-SPAM-1/2, FR-VAL-1/2, D-001, D-009, Risk R-2 |
| **Author** | AutoForm Team |
| **Created** | 2026-06-25 |
| **Last updated** | 2026-06-25 |
| **Version** | 1.0 |
| **Status** | Ready |

---

## 1. Objective

Verify that the public endpoint resists abuse: honeypot-filled submissions are silently
rejected, submissions that don't match the definition are refused, and excessive requests are
rate-limited.

## 2. Scope

**In scope**
- Honeypot silent rejection, unknown/missing-field rejection, and per-IP/per-form rate limiting
  as observed from the submitter's side and confirmed by the owner's inbox.

**Out of scope**
- Successful delivery (TP-004), origin checks/CAPTCHA (Phase 1).

## 3. Test environment

| Item | Value |
|---|---|
| Build / branch / URL | `<main @ commit ____, http://localhost:3000>` |
| Browser(s) / OS | `<e.g. Chrome / Windows 11>` |
| Test account(s) | A signed-in account that owns a form |
| Database state | App connected to a migrated database |
| External integrations | None required |
| Tools | A saved copy of the form's embed; `curl` (or a small loop script) for the rate-limit case |

## 4. Preconditions

- [ ] A form exists with an `email` (required) and `message` field; you have its embed saved
  locally and its endpoint URL noted.
- [ ] You can view the form's **Inbox** as the owner.

## 5. Test data

| Name | Value |
|---|---|
| Honeypot field name | `_gotcha` (the off-screen field in the embed) |
| Valid email | `human@example.com` |
| Unknown field | `nickname=spammy` (not in the definition) |
| Endpoint URL | `<copied from the form's Endpoint card>` |

---

## 6. Test cases

### TC-005.1 — Honeypot submission is silently rejected

| | |
|---|---|
| **Priority** | High |
| **Type** | Error handling / security |
| **Preconditions** | Embed saved locally; inbox visible |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Note the current submission count in the inbox. | Baseline recorded. | | ⬜ Pass / Fail |
| 2 | In the saved embed, type any value into the off-screen honeypot field (`_gotcha`) — e.g. via dev tools — then submit valid email/message. | The submission **appears to succeed** (you land on the success page / get a 2xx) — the trap is invisible to the submitter. | | ⬜ Pass / Fail |
| 3 | Refresh the owner's inbox. | **No new submission** was stored; the count is unchanged. | | ⬜ Pass / Fail |

**Overall expected outcome:** A honeypot-filled submission is silently dropped — looks successful, but nothing is stored or delivered.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-005.2 — Unknown field is rejected

| | |
|---|---|
| **Priority** | High |
| **Type** | Validation |
| **Preconditions** | Endpoint URL known |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Submit the form (or `curl`) including a field not in the definition, e.g. `nickname=spammy`, plus a valid email. | The submission is rejected: the no-JS path shows a friendly error page; an AJAX/JSON request returns `422` with an error identifying the offending field. | | ⬜ Pass / Fail |
| 2 | Check the inbox. | No submission was stored. | | ⬜ Pass / Fail |

**Overall expected outcome:** Submissions with fields outside the schema are refused.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-005.3 — Missing required field is rejected

| | |
|---|---|
| **Priority** | High |
| **Type** | Validation |
| **Preconditions** | Endpoint URL known |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Submit with the required `email` omitted (only `message`). | The submission is rejected with a clear error (friendly page for no-JS, `422` for AJAX). | | ⬜ Pass / Fail |
| 2 | Check the inbox. | No submission was stored. | | ⬜ Pass / Fail |

**Overall expected outcome:** Required fields are enforced server-side.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-005.4 — Rate limiting under rapid repeated requests

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Abuse / edge case |
| **Preconditions** | Endpoint URL known. _Note: the per-form limit defaults to 60 requests/minute per IP and is not yet editable in the dashboard, so triggering it requires a burst of requests — use a loop._ |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | From one machine, send a rapid burst of valid submissions to the endpoint exceeding the per-form limit, e.g. a loop of ~70 `curl` POSTs within a minute. | Early requests succeed; once the limit is crossed, requests return **HTTP 429 (Too many requests)** with a `Retry-After` header (AJAX) or a "Too many requests" page (no-JS). | | ⬜ Pass / Fail |
| 2 | Wait for the rate-limit window to elapse (about a minute) and submit once more. | The submission is accepted again. | | ⬜ Pass / Fail |

**Overall expected outcome:** Excessive requests from one source are throttled, then recover after the window.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

## 7. Results summary

| Test case | Title | Result | Notes |
|---|---|---|---|
| TC-005.1 | Honeypot silent rejection | ⬜ Pass / Fail / Blocked | |
| TC-005.2 | Unknown field rejected | ⬜ Pass / Fail / Blocked | |
| TC-005.3 | Missing required field rejected | ⬜ Pass / Fail / Blocked | |
| TC-005.4 | Rate limiting | ⬜ Pass / Fail / Blocked | |

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
