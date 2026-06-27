<!--
  AutoForm — Manual Test Plan Template
  --------------------------------------------------------------------------
  HOW TO USE THIS TEMPLATE
  - Copy this file to test_plans/ with a descriptive, human-readable name ending in
    "Test Plan" (e.g. "Form Lifecycle Management Test Plan.md").
  - Fill in every <placeholder>. Delete guidance comments (like this one) and any
    italic “_Guidance:_” notes before finalizing.
  - Keep it human-followable: each step is an action a tester performs and the
    result they should observe. Do NOT reference unit tests or code internals.
  - One test plan covers one coherent feature or flow. Use multiple Test Cases
    within it for distinct paths (happy path, edge cases, error handling).
-->

# Test Plan: `<Title>`

| | |
|---|---|
| **Test Plan ID** | TP-`<NNN>` |
| **Feature / Area** | `<e.g. Form creation & delivery, Auth, Dashboard inbox>` |
| **Related user story / requirement** | `<e.g. USERSTORIES.md #3 (Dana), FR-ING-1>` |
| **Author** | `<name>` |
| **Created** | `<YYYY-MM-DD>` |
| **Last updated** | `<YYYY-MM-DD>` |
| **Version** | `<1.0>` |
| **Status** | `<Draft / Ready / In progress / Complete>` |

---

## 1. Objective

_Guidance: One or two sentences on what this plan verifies and why it matters._

`<What is being tested and the outcome it should prove.>`

## 2. Scope

**In scope**
- `<flow / screen / behavior covered>`

**Out of scope**
- `<explicitly not covered here — link to the plan that does, if any>`

## 3. Test environment

_Guidance: Everything a tester needs to reproduce the run. Be specific._

| Item | Value |
|---|---|
| Build / branch / URL | `<e.g. main @ commit abc123, http://localhost:3000>` |
| Browser(s) / OS | `<e.g. Chrome 124 / Windows 11, Safari / macOS>` |
| Viewport(s) | `<e.g. Desktop 1440px, Mobile 390px>` |
| Test account(s) | `<email(s) used; note if throwaway>` |
| Database state | `<fresh / seeded / existing — and how to reset>` |
| External integrations | `<e.g. a request-bin/webhook sink URL, a test email inbox, Resend test key>` |

## 4. Preconditions

_Guidance: State that must be true before starting (checklist)._

- [ ] `<e.g. A test account exists and is signed in>`
- [ ] `<e.g. A webhook sink is running and its URL is noted>`

## 5. Test data

_Guidance: Concrete inputs to use, so runs are repeatable. Omit if not applicable._

| Name | Value |
|---|---|
| `<Valid email>` | `<tester@example.com>` |
| `<Form definition>` | `<paste or link the JSON used>` |

---

## 6. Test cases

_Guidance: Duplicate the block below for each case. Steps go in order; each row is
one tester action and the result they should see. Fill **Actual result** and
**Status** during execution._

### TC-`<NNN.1>` — `<Test case title>`

| | |
|---|---|
| **Priority** | `<High / Medium / Low>` |
| **Type** | `<Happy path / Edge case / Error handling / UI-UX / Accessibility>` |
| **Preconditions** | `<specific to this case, if any>` |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | `<what the tester does>` | `<what should happen>` | | ⬜ Pass / Fail |
| 2 | `<...>` | `<...>` | | ⬜ Pass / Fail |
| 3 | `<...>` | `<...>` | | ⬜ Pass / Fail |

**Overall expected outcome:** `<the end state if all steps pass>`

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<one-line summary / link to defect>`

---

### TC-`<NNN.2>` — `<Next test case title>`

| | |
|---|---|
| **Priority** | `<High / Medium / Low>` |
| **Type** | `<...>` |
| **Preconditions** | `<...>` |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | `<...>` | `<...>` | | ⬜ Pass / Fail |

**Overall expected outcome:** `<...>`

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<...>`

---

## 7. Results summary

_Guidance: Roll up each test case after execution._

| Test case | Title | Result | Notes |
|---|---|---|---|
| TC-`<NNN.1>` | `<title>` | ⬜ Pass / Fail / Blocked | |
| TC-`<NNN.2>` | `<title>` | ⬜ Pass / Fail / Blocked | |

**Run summary:** `<X passed, Y failed, Z blocked>` — tested by `<name>` on `<YYYY-MM-DD>`.

## 8. Defects & observations

_Guidance: Log anything that failed or felt off (bugs, confusing copy, slow steps,
UI/UX rough edges). Link to an issue if one is filed._

| ID | Severity | Test case | Description | Issue link |
|---|---|---|---|---|
| `<D-1>` | `<Critical / Major / Minor / Cosmetic>` | TC-`<NNN.x>` | `<what happened vs. expected>` | `<url>` |

## 9. Sign-off

| Role | Name | Date | Decision |
|---|---|---|---|
| Tester | `<name>` | `<YYYY-MM-DD>` | ⬜ Pass ⬜ Fail |
| Reviewer | `<name>` | `<YYYY-MM-DD>` | ⬜ Approved ⬜ Changes requested |

---

## Revision history

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | `<YYYY-MM-DD>` | `<name>` | Initial draft. |
