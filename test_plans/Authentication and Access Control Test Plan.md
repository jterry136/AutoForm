# Test Plan: Authentication & Access Control

| | |
|---|---|
| **Test Plan ID** | TP-001 |
| **Feature / Area** | Authentication, session, route protection |
| **Related user story / requirement** | USERSTORIES.md #1/#3 (account holders), FR-ACC-1, NFR-SEC-2 |
| **Author** | AutoForm Team |
| **Created** | 2026-06-25 |
| **Last updated** | 2026-06-25 |
| **Version** | 1.0 |
| **Status** | Ready |

---

## 1. Objective

Verify that a new user can register, sign out, and sign back in, that an active session is
recognized across the app, and that the dashboard is inaccessible without authentication.

## 2. Scope

**In scope**
- Sign up (`/signup`), sign in (`/login`), sign out, and the `/dashboard` route guard.
- Invalid-credential handling and basic form validation.

**Out of scope**
- Password reset, email verification, OAuth/social login (not in the MVP).
- Form/destination behavior (see TP-002, TP-003).

## 3. Test environment

| Item | Value |
|---|---|
| Build / branch / URL | `<main @ commit ____, http://localhost:3000>` |
| Browser(s) / OS | `<e.g. Chrome / Windows 11>` |
| Viewport(s) | `<Desktop 1440px, Mobile 390px>` |
| Test account(s) | A throwaway email you control (no real inbox required) |
| Database state | App connected to a migrated database |
| External integrations | None |

## 4. Preconditions

- [ ] The app is running and reachable at the URL above.
- [ ] You are signed out (no active session) at the start.

## 5. Test data

| Name | Value |
|---|---|
| New account name | `Test User` |
| New account email | `qa+auth-001@example.com` (use a unique value per run) |
| Password (valid) | `Sup3rSecret!` |
| Password (too short) | `short` |

---

## 6. Test cases

### TC-001.1 — Register a new account (happy path)

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | Signed out |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Navigate to `/signup`. | The sign-up form shows Name, Email, Password fields. | | ⬜ Pass / Fail |
| 2 | Enter the valid name, email, and password; submit. | No error toast; you are redirected to `/dashboard`. | | ⬜ Pass / Fail |
| 3 | Observe the dashboard header. | Your email is shown and a **Sign out** button is present. | | ⬜ Pass / Fail |
| 4 | Refresh the page. | You remain on the dashboard (session persists). | | ⬜ Pass / Fail |

**Overall expected outcome:** A new account is created and the user is signed in on the dashboard.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-001.2 — Sign out

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | Signed in (from TC-001.1) |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Click **Sign out** in the dashboard header. | You are redirected to `/login`. | | ⬜ Pass / Fail |
| 2 | Manually navigate to `/dashboard`. | You are redirected back to `/login` (no access). | | ⬜ Pass / Fail |

**Overall expected outcome:** The session ends and protected pages are no longer accessible.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-001.3 — Sign in with valid credentials

| | |
|---|---|
| **Priority** | High |
| **Type** | Happy path |
| **Preconditions** | The account from TC-001.1 exists; signed out |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | Go to `/login`, enter the account email + password, submit. | No error; redirected to `/dashboard`. | | ⬜ Pass / Fail |

**Overall expected outcome:** A returning user signs in successfully.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-001.4 — Dashboard is protected when unauthenticated

| | |
|---|---|
| **Priority** | High |
| **Type** | Error handling / security |
| **Preconditions** | Signed out |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | In a fresh/incognito window, navigate directly to `/dashboard`. | You are redirected to `/login`; no dashboard content is shown. | | ⬜ Pass / Fail |
| 2 | Navigate directly to a form detail URL `/dashboard/forms/anything`. | You are redirected to `/login`. | | ⬜ Pass / Fail |

**Overall expected outcome:** Protected routes are inaccessible without a session.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

### TC-001.5 — Invalid credentials & weak password

| | |
|---|---|
| **Priority** | Medium |
| **Type** | Error handling |
| **Preconditions** | Signed out |

| # | Action | Expected result | Actual result | Status |
|---|---|---|---|---|
| 1 | At `/login`, enter the correct email but a wrong password; submit. | An error message appears; you stay on `/login` (not signed in). | | ⬜ Pass / Fail |
| 2 | At `/signup`, try to register with the too-short password. | Sign-up is rejected (validation/error); no account is created. | | ⬜ Pass / Fail |

**Overall expected outcome:** Bad credentials and weak passwords are rejected with clear feedback.

**Result:** ⬜ Pass ⬜ Fail ⬜ Blocked — `<summary>`

---

## 7. Results summary

| Test case | Title | Result | Notes |
|---|---|---|---|
| TC-001.1 | Register a new account | ⬜ Pass / Fail / Blocked | |
| TC-001.2 | Sign out | ⬜ Pass / Fail / Blocked | |
| TC-001.3 | Sign in (valid) | ⬜ Pass / Fail / Blocked | |
| TC-001.4 | Dashboard protected | ⬜ Pass / Fail / Blocked | |
| TC-001.5 | Invalid credentials | ⬜ Pass / Fail / Blocked | |

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
