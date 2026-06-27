# Test Plan: Form Lifecycle Management

| | |
|---|---|
| **Test Plan ID** | TP-002 |
| **Feature / Area** | Dashboard — create, list, rename, delete forms; definition authoring |
| **Related user story / requirement** | USERSTORIES.md #1/#3, FR-ACC-2/3, D-001, D-002 |
| **Author** | AutoForm Team |
| **Created** | 2026-06-25 |
| **Last updated** | 2026-06-25 |
| **Version** | 1.0 |
| **Status** | Ready |

---

## 1. Objective

Verify that an authenticated user can create a form with a valid definition, sees it listed
with counts and an endpoint, and can rename and delete it — and that invalid definitions are
rejected.

## 2. Scope

**In scope**
- Create form (name + JSON definition), list view with counts, form detail (endpoint/public ID),
  rename, delete, and definition validation errors.

**Out of scope**
- Destinations (TP-003), embedding/submission (TP-004), spam (TP-005).

## 3. Test environment

| Item | Value |
|---|---|
| Build / branch / URL | `<main @ commit ____, http://localhost:3000>` |
| Browser(s) / OS | `<e.g. Chrome / Windows 11>` |
| Viewport(s) | `<Desktop 1440px>` |
| Test account(s) | A signed-in test account |
| Database state | App connected to a migrated database |
| External integrations | None |

## 4. Preconditions

- [ ] You are signed in and on `/dashboard`.

## 5. Test data

| Name | Value |
|---|---|
| Form name | `Contact form` |
| Valid definition | ```{ "version": 1, "fields": [ { "name": "email", "label": "Email", "type": "email", "required": true }, { "name": "message", "label": "Message", "type": "textarea" } ] }``` |
| Invalid JSON | `{ "version": 1, "fields": [ ` (truncated, unparseable) |
| Schema-invalid definition | ```{ "version": 1, "fields": [] }``` (empty fields) |
| Reserved-name definition | A field with `"name": "_redirect"` |

---

## 6. Test cases

### TC-002.1 — Create a form with a valid definition

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | Signed in |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Click **New form**. | A dialog opens with a Name field and a Definition (JSON) textarea pre-filled with a sample. | | ⬜ Pass / Fail |
| 2 | Enter the form name and the valid definition; click **Create form**. | A success confirmation appears and the dialog closes. | | ⬜ Pass / Fail |
| 3 | Observe the forms table. | The new form is listed with **0** submissions and **0** destinations. | | ⬜ Pass / Fail |
| 4 | Click the form name to open its detail page. | The page shows the **Endpoint** URL and a **Public ID** beginning with `f_`. | | ⬜ Pass / Fail |
| 5 | Review the **Definition** section. | It shows the JSON you entered. | | ⬜ Pass / Fail |

**Overall expected outcome:** The form is created with its mandatory definition and an endpoint.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-002.2 — Reject invalid JSON

| | |
|---|---|
| **Priority** | High |
| **Type** | Error handling |
| **Preconditions** | Signed in |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Open **New form**, enter a name, and paste the **Invalid JSON** value; submit. | An error indicates the definition must be valid JSON; the form is **not** created. | | ⬜ Pass / Fail |
| 2 | Close the dialog and check the list. | No new form was added. | | ⬜ Pass / Fail |

**Overall expected outcome:** Unparseable JSON is rejected before any form is created.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-002.3 — Reject a schema-invalid definition

| | |
|---|---|
| **Priority** | High |
| **Type** | Edge case / validation |
| **Preconditions** | Signed in |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Open **New form** and submit with the **empty fields** definition. | An "invalid form definition" error appears; no form is created. | | ⬜ Pass / Fail |
| 2 | Try again with a field named `_redirect` (reserved name). | The definition is rejected. | | ⬜ Pass / Fail |
| 3 | Try a definition with two fields sharing the same `name`. | The definition is rejected (names must be unique). | | ⬜ Pass / Fail |

**Overall expected outcome:** Definitions that violate the schema rules are rejected with a clear message.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-002.4 — Rename a form

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Happy path |
| **Preconditions** | At least one form exists (TC-002.1) |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Open the form's detail page and click the **rename** (pencil) control next to the title. | A rename dialog opens with the current name. | | ⬜ Pass / Fail |
| 2 | Change the name and save. | A success confirmation appears; the title updates. | | ⬜ Pass / Fail |
| 3 | Return to the forms list. | The form shows the new name. | | ⬜ Pass / Fail |

**Overall expected outcome:** The form's display name updates everywhere.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-002.5 — Delete a form

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Happy path / destructive |
| **Preconditions** | At least one form exists |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | In the forms list, click the **delete** (trash) control for the form. | A confirmation prompt appears warning that submissions will be deleted. | | ⬜ Pass / Fail |
| 2 | Cancel the prompt. | The form remains in the list. | | ⬜ Pass / Fail |
| 3 | Click delete again and confirm. | A success confirmation appears; the form is removed from the list. | | ⬜ Pass / Fail |

**Overall expected outcome:** Deletion is confirmed and removes the form (and its data).

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

## 7. Results summary

| Test case | Title | Result | Notes |
|---|---|---|---|
| TC-002.1 | Create form (valid) | ⬜ Pass / Fail / Blocked | |
| TC-002.2 | Reject invalid JSON | ⬜ Pass / Fail / Blocked | |
| TC-002.3 | Reject schema-invalid definition | ⬜ Pass / Fail / Blocked | |
| TC-002.4 | Rename form | ⬜ Pass / Fail / Blocked | |
| TC-002.5 | Delete form | ⬜ Pass / Fail / Blocked | |

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
