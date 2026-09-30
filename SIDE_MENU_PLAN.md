# Side Menu Redesign (landing page → burger menu + cohort switcher): Plan

**Status:** **v1.1 (30 Sep 2026): all decisions settled.** Nothing in this document has been built or changed. No database, code, Vercel or Supabase setting was touched.
**Scope:** Removing the landing page as a separate screen. Everyone lands straight on a Dashboard. The landing page's links move into a burger menu on every page. A cohort switcher at the top of that menu replaces the "Load [Member] Data" dropdown.
**Out of scope:** Any change to who can see or edit what. The Group Ladder Redesign (`GROUP_LADDER_PLAN.md`). A permanent desktop sidebar.
**Standing rule (yours):** every change, however minor, goes to QA first. It reaches production only after testing and your explicit go-ahead.

**Legend:** ✅ = decided by you. ⏳ = a new question from this analysis, with my recommendation. 🔎 = a finding from reading the code.

---

## 1. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | The landing page stops being a page. Users land on the **Dashboard** of a cohort, with the same 5 tabs as today. The only header change: the **Home button becomes a burger button** that opens the old landing page's options as a side menu. | ✅ |
| D2 | The Dashboard banner already shows the cohort name under the app title. **No change.** | ✅ |
| D3 | **Landing rules:** a Servant or Sub-Coordinator lands on the cohort they serve, even if they have read-only access to others. A General Coordinator lands on the **Combined** view. An Admin with a cohort assignment follows the Servant path; an Admin without one follows the General Coordinator path. | ✅ |
| D4 | **More than one assigned cohort:** land on the **first listed** cohort (App Settings display order). | ✅ |
| D5 | **No assignment and not a General Coordinator/Admin:** show **"No group assigned yet"**. | ✅ |
| D6 | **Don't remember the last cohort viewed**, except for a servant assigned to more than one cohort. They land back on the last one of *their assigned* cohorts they opened, falling back to the first listed. | ✅ |
| D7 | The landing target **always follows the current assignment**, whether it changes at year end or mid-year. It is worked out fresh on every visit and never stored as a fixed group. | ✅ |
| D8 | **Cohort switcher at the top of the side menu**, collapsed to one line showing the current cohort. **Hidden for anyone with only one cohort.** | ✅ |
| D9 | **Bible verse moves into the top banner**, near its bottom edge. | ✅ |
| D8a | **Revised after QA (30 Sep):** the cohort row shows for **everyone with a cohort**, even a single-cohort servant, as an obvious way back to their Dashboard. With one cohort it's a plain "<cohort> Dashboard ›" link; with several it opens the switcher list. | ✅ |
| D8b | **Cohort row (after QA, round 2):** shows the person's **default cohort** (where `/` lands them; Combined for a General Coordinator), not the page they're on. Tapping the name opens its Dashboard; the arrow opens the full list. The list is always in the **same fixed order** for everyone: Yr 0 (Admins only), Yr 1 up through the last, then Combined at the bottom, each person seeing only the ones they can open. | ✅ |
| D12 | **Header, all pages (after QA):** Exit and Version move to the menu only. The banner's top left is **Menu** then **Back** (previous screen, no reload; with nothing to go back to, your Dashboard); **Refresh** moves to the top right. Signed-out youth on member QR codes see neither Menu nor Back. The Service Calendar became an ordinary page (`/calendar`) with the same header, replacing its full-screen pop-up (after QA: the pop-up's Menu button jumped back to the Dashboard). | ✅ |
| D13 | **Verse in yellow; menu headings shaded in the brand colour, entries indented** (after QA). | ✅ |
| D10 | **Burger everywhere, on phone and desktop alike.** No permanent desktop sidebar. | ✅ |
| D11 | **HSY coordinators** land on their first listed class for now. This gets revisited under the Group Ladder Redesign. | ✅ |
| Q1 | **Which banners show the verse?** Recommendation: **the cohort pages only** (Dashboard, Member List, Attendance, Outreach, Analytics), since they replace the landing page. It is picked once when a cohort is opened and stays the same as you move between its tabs; it doesn't change on every tab click and costs no extra time per tab (§3.4). Admin and directory pages keep their plain banner. | ✅ |
| Q2 | **A long verse on a phone.** The banner is "sticky" (it stays on screen when you scroll), so a 4-line verse would permanently take a quarter of the phone screen. Decision: **one line in a small font, cut with "…"; tapping it shows the full verse**. | ✅ |
| Q3 | **Revised after QA (round 3):** a person with read-only access only **lands straight on the first of their read-only cohorts** (fixed switcher order), and the menu row shows it. "No group assigned yet" is now only for someone with no cohort they can open at all, and **nobody ever sees "Choose a cohort"**. | ✅ |

---

## 2. How it works today (verified)

🔎 **The landing page** is `web/src/app/page.tsx`. It loads your roles, the cohort list, the Pending Servants count and a random verse, then shows the Servant, Coordinator and System Admin Corners. It also records an `APP_ACCESS` audit entry on every visit.

🔎 **Cohort pages** all live under `/g/<cohort>/…`, drawn by one shared header (`GroupNavShell.tsx`). The app logo in that header already links to `/`.

🔎 **The Home button** is one shared component (`HomeLink.tsx`), used by **19 files**: the cohort header, plus the admin, directory, QR, calendar and other pages. It also appears on the Service Calendar pop-up. Changing that one component changes every page.

🔎 **Every other link or redirect to `/`** (sign-in, finishing registration, the logo on each page's banner, and the inactive-ministry and unknown-address checks) will now end on the user's Dashboard instead of the landing page, because `/` becomes the landing rule. That is the intended behaviour. Each one gets checked once (§5).

🔎 **"Load [Member] Data"** (`LoadGroupPanel`) and **"Load all cohorts"** (`LoadAllCohortsButton`) are only used on the landing page. They record a `GROUP_SELECTED` audit entry when a cohort is loaded. The switcher keeps recording that entry.

🔎 **Which cohorts appear in the dropdown** is already worked out by `filterSelectableGroups()` in `lib/groups.ts`: every cohort for Admin/General Coordinator, otherwise only cohorts where the user holds a role. The switcher reuses it unchanged, so **nobody gains access to anything new**.

---

## 3. Target design

### 3.1 Landing rule (what `/` does)

Worked out in this order, from the roles already loaded:

1. **Not signed in:** go to sign-in (unchanged).
2. **Serves one or more cohorts** (any role row other than read-only that points at a specific cohort: Servant, Sub-Coordinator, or Admin/GC who also serves one): go to that cohort's **Dashboard**. With more than one, use the last one opened (D6) if it is still one of theirs, otherwise the first listed (D4).
3. **Admin or General Coordinator without a cohort:** go to the **Combined** Dashboard.
4. **Otherwise:** show **"No group assigned yet"** with the burger available (D5).

The `APP_ACCESS` audit entry keeps being recorded at step 2–4, as today.

### 3.2 The side menu

Opens from the burger at the top left of every banner, and slides in over the page from the left. Contents, top to bottom:

- **Cohort switcher** (only if the user can see 2 or more cohorts): one line showing the current cohort ▾. Tapping it lists every cohort they can open, with small tags ("serving", "view only", "admin"). Order: their own cohort(s) first, then Combined (Admin/GC only), then the rest in display order, then **Year 0 (pre-entry)** for Admins, moved here from the System Admin Corner.
- **Servant Corner:** Servant Directory, Service Calendar, Checkin – QR Codes, Release History.
- **Coordinator Corner** (coordinators and Admins): Servant Profiles, Servant Assignments, Servant Attendance, Print/Export Lists, Pending Servants with its count (Admin/GC).
- **System Admin Corner** (Admins): the same 8 links as today.
- **Footer:** version number and Sign out.

"Load all cohorts" disappears as a separate button; it becomes the **Combined** entry in the switcher.

### 3.3 Header

The Home button (icon + "Home") becomes a burger icon, with a spinner while the menu data loads. Refresh, Sign out and Version stay where they are. The cohort name stays under the title (D2). The verse sits along the bottom edge of the cohort banner (D9, Q1, Q2: one line, small font, tap to expand).

### 3.4 Keeping tab switching fast (revised after QA: menu speed)

The menu's data comes from a plain data URL (`/api/menu`), not a server action. Next.js runs server actions one at a time, behind any navigation in flight, and they're meant for changes, not reads. It checks who you are locally from the sign-in token (no extra trip to the sign-in server).

Once a page has settled (browser idle), the menu's code and data are **preloaded quietly in the background**, once per page load. They're kept for the browser tab's session, so the menu opens **instantly**, even after a full reload, and refreshes in the background when opened, keeping the Pending Servants count current. The saved copy is cleared on Exit and on the sign-in page, so the next person on a shared device never sees it. Nothing is added to the page load itself or to tab switching.

The verse is fetched by the cohort layout, which Next.js does **not** re-run when you switch tabs within the same cohort, so it adds no delay per tab either.

---

## 4. Execution plan

Each step is a separate commit on `qa`. Nothing reaches `main` until you've tested and approved.

| Step | Change | Files (main ones) |
|---|---|---|
| 1 | **Side menu component** + one server action that returns the menu's data (roles, switcher cohorts, pending count), fetched on first open | new `components/SideMenu.tsx`, `app/actions.ts` |
| 2 | **Burger replaces Home** in the shared button; Service Calendar opens from the menu | `components/HomeLink.tsx` (→ `MenuButton`), the 19 pages that use it |
| 3 | **Landing rule:** `/` redirects per §3.1 or shows "No group assigned yet"; remember the last cohort only for multi-cohort servants (a cookie, checked against current assignments on every visit) | `app/page.tsx`, `lib/groups.ts` |
| 4 | **Verse in the cohort banner** (one line, tap to expand) | `app/g/[groupId]/layout.tsx`, `components/GroupNavShell.tsx` |
| 5 | **Remove** the now-unused `LoadGroupPanel` and `LoadAllCohortsButton` | those 2 components |
| 6 | **Docs:** REQUIREMENTS §6.1 (landing) and §6.2 (navigation) rewritten; Revision Log entry | `REQUIREMENTS.md` |

No database change, migration, or security-rule change is needed.

---

## 5. Verification plan

**Done by me before handing to you:**

- Build and lint pass.
- **Landing rule per role**, checked against the QA data by running the rule for real QA users of each kind: single-cohort servant, servant + read-only, multi-cohort servant, Sub-Coordinator, General Coordinator, Admin with and without a cohort, HSY coordinator, no assignment. For each: the expected landing cohort and switcher list.
- **Signed-out checks** in the browser: `/` and every page still send you to sign-in.
- **Every former link to `/`** (sign-in, registration, logos, error/redirect pages) ends on the right Dashboard.
- **Tab-switch timing** measured before and after on QA, to confirm §3.4 holds.

**Needs you (signed in on QA):** a real walk-through as a few roles, on your phone and on a computer: open the app, open the menu, switch cohorts, move between tabs, open a couple of admin pages and come back. I'll list exactly which accounts and steps.

---

## 6. Rollback

Code only, no data touched: reverting the commits on `qa` (or `main` after release) puts the landing page back exactly as it was.

---

## 7. Risks

| Risk | Effect | Mitigation |
|---|---|---|
| Menu data loaded on every page | Slower tab switching | Load on first menu open only, keep for the visit (§3.4); measured before/after |
| Landing rule picks a cohort the user can't open | User lands on "not found" the moment they open the app | Rule only picks from cohorts they hold a role at; per-role checks (§5) |
| A link or redirect still expects the old landing page | Odd jump after sign-in, registration, etc. | Every `/` link listed in §2 checked once |
| Long verse in a sticky banner | Takes space on phones | Q2: 1-line limit, tap to expand |
| Group Ladder changes (hidden terminal, HSY classes) | Switcher list and HSY landing change later | Switcher reuses `filterSelectableGroups()`, so ladder changes flow through; D11 revisited then |
