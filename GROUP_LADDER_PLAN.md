# Group Ladder Redesign (pre-entry, levels, hand-over terminal): Analysis & Plan

**Status:** **Draft v1.3 (30 Sep 2026), for your review.** v1.3 applies your answers to Q10, Q11 and the Read-Only assumption, plus your Coordinator idea for Kristeen and Mike; those changes are marked 🆕 and listed in "What changed in v1.3". v1.2 applied your review comments (marked 🔄, listed in "What changed in v1.2"). v1.1 brought the plan up to date with the side menu and App Settings changes. Nothing in this document has been built or changed. No database, storage, code, Vercel or Supabase setting was touched. Every figure below comes from read-only queries run on 30 Sep 2026.
**Scope:** How groups are ordered, advanced and hidden, in every ministry. It covers the App Settings Group Names panel, the Group Transition, the QR Codes page and the database security rules for hidden groups. It also covers the one-time split of SAY's "2004 & older" group.
**Out of scope (later phases, §10):** moving people from one ministry to the next ("hand-over"), and Sunday School's and High School's own class rules.
**Standing rule (yours):** every change, however minor, goes to QA first. It reaches production only after testing and your explicit go-ahead. This plan has no step that touches production without passing through QA first.

**Legend:** ✅ = decided by you. 🔓 = **OPEN item you'll confirm later** (items 1 and 2). ⏳ = a new question from this analysis, with my recommendation. 🔎 = a finding from reading the code or the data. 🔄 = changed in v1.2 because of your review comments. 🆕 = changed in v1.3.

## 🆕 What changed in v1.3 (30 Sep 2026)

| # | Your answer | Change in this plan | Where |
|---|---|---|---|
| B1 | Q10: automatic | **Decided:** the coordinator's combined view is built automatically from Coordinator grants. The "class sets" option is dropped. | Q10, D14, §4.6 |
| B2 | Q11: place new sign-ups by birth year | **Decided:** a new sign-up through a shared code goes to the sharing group whose cohort year matches their birth year. The edge cases follow the split's own rules (older → hand-over, slightly younger → youngest group, no or impossible date → oldest regular group). | Q11, §4.2, V8 |
| B3 | Read-Only assumption is correct | Ramez's and Amgad's Read-Only covers Yr 5 **and** Yr 6 | O2, §5.4 |
| B4 | Make Kristeen and Mike **Coordinators of Yr 5 and Yr 6**, so each gets a combined view while the two cohorts stay separate | **Yes, that's how it works** (new option E in §5.4, now the provisional O2). SAY's "Coordinators automatically become servants" setting gives them Servant grants on both groups too, so all 34 assignments stay valid. Each lands on a combined "Yr 5 + Yr 6" view. | O2, §4.6, §5.4, §5.6 |
| B5 | (found while applying B4) | **Combined view name:** "2004 - Yr 5" and "2003 - Yr 6" share no leading words, so the name falls back to the levels: **"Yr 5 + Yr 6"**. | §4.6 |
| B6 | (found while applying B4) | **New question Q12:** next September "2003 - Yr 6" graduates. Today's rule would send Kristeen's and Mike's Yr 6 grants back to the new Yr 1, although they still serve Yr 6 (the former Yr 5). Recommendation: **when someone still holds a grant on a group that stays, their graduating group's grants are dropped instead of rolled back.** | Q12, §4.2 step 4 |
| B7 | Q12: drop the grants; the "Yr 5 + Yr 6" name is fine | **Q12 decided** (grants on the graduating group are dropped for anyone who still serves a group that stays). Combined-view naming (B5) confirmed. | Q12, §4.2, §4.6 |

## 🔄 What changed in v1.2 (your review, 30 Sep 2026)

| # | Your comment | Change in this plan | Where |
|---|---|---|---|
| A1 | D5: put the QR switches with the QR Code Colors. §4.1: pre-entry QR off by default, terminal on; the terminal keeps capturing attendance until hand-over, then is turned off. | The two switches now sit **on the pre-entry and hand-over rows** of the Group Names & QR Code Colors panel. They mean **"QR code active"**: off hides the code from the QR page and printing for everyone, and scanning it says the code isn't active. Defaults: **pre-entry off, hand-over on**. | D5, §4.1, §4.2, §4.4, §4.5 |
| A2 | Q4: No | A switched-off code is hidden from Admins too. To print Yr 0 in August, turn its switch on. | Q4, §4.2 |
| A3 | D10: call it "2002 - Transitioning" | SAY's hand-over group is **"2002 - Transitioning"** (not "2002 & Older") | D10, §4.1, §5 |
| A4 | Q3: yes; let the Admin set the pattern at the top of the Group Names panel | SAY pattern → `{cohort_year} - Yr {level}`. The **Default name pattern** field moves to the **top** of the panel, and new groups start from it. | Q3, §4.5 |
| A5 | §2.2 / §3.1: High School names "Gr10 Boys St Moses", with "Gr" from the position label | New placeholder **`{label}`** (the position label). High School's pattern: `{label}{level} Boys St Anthony` → "Gr9 Boys St Anthony", "Gr10 Boys St Anthony"… | §3.1, §10.2 |
| A6 | §3.2: at transition, ask whether the graduating groups become one group, one per gender, or stay separate | **New D12.** When two or more groups graduate, the transition asks: **one hand-over group / one per gender / keep each class separate**. So a ministry can have more than one hand-over group. SAY (one group graduating) is never asked. | D12, §3.1, §3.2, §4.1, §4.2, §4.5 |
| A7 | Q8 / §5.5: keep the one "2004 & older" QR code for Yr 5, Yr 6 and the hand-over group, recording attendance wherever the name is | **Possible, and adopted as new D13: a shared check-in code.** A group can use another group's code. The code then lists the names of every group that uses it, and attendance is recorded for the person, as it already is today. The old poster keeps working for all three groups, so no reprinting, and the mis-filing risk (R3) goes away. **New question Q11:** which group new sign-ups through a shared code go into. | D13, Q8, Q11, §4.1, §4.2, §4.4, §5.2, §5.5, R3 |
| A8 | §5.5: automatically give each new group a QR colour distinct from the ministry's others, Servants included | Adding a group (and the split, and a new pre-entry at transition) **picks an unused, distinct colour automatically**. You can still change it with the colour dot. | §4.2, §5.5 |
| A9 | Q9: always Yr 0, 1, 2, 3… | Confirmed: the new level 1 goes first among the regular groups | Q9 |
| A10 | Q5, Q6, Q7 | Q5 ✅ (both hidden groups in the Admin's switcher). Q6 ✅ (moving a servant clears their assignments in the group they leave, with a warning). Q7 ✅ (2003 stays in SAY; when Connect2 is set up, the 2003 cohort is **excluded** from its list). | Q5–Q7, §10.4 |
| A11 | §5.1, §5.3, §5.4: the four born in 2005 → Yr 5; the 43 bad dates → option A (to confirm); Kristeen and Mike serve **both** Yr 5 and Yr 6, keeping all their assignments (to confirm) | Applied as **provisional answers** to O1 and O2 (🔓 until you confirm). Result: Yr 5 = 152, Yr 6 = 178, hand-over = 63. **One assumption for you to confirm:** Ramez's and Amgad's Read-Only also covers Yr 6. | O1, O2, §5 |
| A12 | D6: where do archived records go, and do they fill the free database? | Answered in D6 with real sizes. A later **"Permanently delete people archived more than N years ago"** tool is added to §10.5. | D6, §10.5 |
| A13 | General: High School coordinators need their 2 classes as one combined group, as their default view | **New D14 (question Q10):** a **coordinator's combined view**, built automatically from the classes where the person is Coordinator. It's their default landing and appears in their switcher, named from what the class names share (e.g. "Gr10 Boys"). No set-up needed. | D14, Q10, §4.6 |

## What changed in v1.1 (30 Sep 2026)

The app changed on 30 Sep, after v1 was written. This version catches up:

| # | Change in the app | Effect on this plan |
|---|---|---|
| C1 | **Side menu (SIDE_MENU_PLAN.md, live in QA and prod):** the landing page is gone. `/` goes straight to your default cohort's Dashboard, and a **cohort switcher** at the top of the side menu replaces the "Load [Member] Data" dropdown. Yr 0 is no longer an Admin Corner "View" button: it's the first entry in the switcher for Admins, tagged "admin". | Every "landing page / dropdown / Admin Corner button" reference now points to the **side-menu cohort switcher** and the **default-cohort rule** (`pickDefaultGroupId`, `buildSwitcherEntries` in `lib/groups.ts`). **Q5 is mostly answered by the side menu:** the terminal joins the switcher for Admins, last before Combined (§4.5). |
| C2 | **The switcher's list order is fixed by level** (Yr 0, Yr 1…last, then Combined), while `/` picks the "first listed" cohort by **display order**. | With classes sharing a level, and with manual up/down ordering (D4), both must use the same order: display order (§2.3, §4.5). |
| C3 | Side-menu decision **D11: High School coordinators land on their first listed class for now**, to be revisited here. | Added to §10.2. With your 30 Sep answers (two coordinators per grade, 2 classes each, moving up with their classes), that default is fine: it follows display order. |
| C5 | **Migration numbers:** 0068 is now the QA-only "Refresh QA from production" (30 Sep). | This plan's migrations are renumbered **0069** (ladder) and **0070** (SAY split). After the ladder change, the refresh copies the new group columns automatically, because it copies the columns both schemas share. |
| C4 | **App Settings:** "App Labels & Branding" is now two panels, **App Labels** and **App Branding**. "Group Names" is now **"Group Names & QR Code Colors"**, with a QR colour dot on each group and a Servants row. The role shows as **"Coordinator"** everywhere. | Panel names and the Group Names spec updated (§4.5). Q8 colours can be set with the dots. |

---

## 0. How to read this

| Section | Content |
|---|---|
| 1 | Decisions: yours (✅), open (🔓), new questions (⏳) |
| 2 | How the ladder works today (verified), incl. every code location that depends on it |
| 3 | Target model and why |
| 4 | Exact change specs: tables, functions, security rules, app screens |
| 5 | SAY one-time split of "2004 & older" |
| 6 | Execution plan with approval gates (QA first) |
| 7 | Verification plan |
| 8 | Rollback plan |
| 9 | Risks |
| 10 | Open items and later phases |

**Words used.** A **group** is one row in the groups list (a SAY cohort, or a High School class). Its **level** is the step the Group Transition advances (Yr 1, Yr 2… or Grade 9, 10…). Its **display order** is where it appears in lists and the side menu's cohort switcher. The **pre-entry** group is the hidden intake group (SAY "Yr 0"). The **terminal** group is the hidden hand-over group (people waiting to move to the next ministry).

---

## 1. Decisions

| # | Decision | Status |
|---|---|---|
| D1 | **Terminal = hand-over holding group.** Each ministry has two hidden groups, visible only to its Admins and the Church Admin: **pre-entry** (first) and **terminal** (last). Chain: Sunday School → Junior High → High School (Grade 12) → SAY Yr 0 → SAY terminal → Connect2. | ✅ |
| D2 | **Attendance continues in every group, including the terminal**, through QR self check-in, so the terminal's QR must be printable. **Yr 0 is unchanged**: intake-only QR, no attendance. | ✅ |
| D3 | **No "+" names** (no "Yr 5+"). **The terminal is no longer cumulative.** That merging logic is removed. | ✅ |
| D4 | **App Settings:** a new group is always added at the end, just before the terminal. Groups can be moved up and down, and that order drives the side menu's cohort switcher (it replaced the landing-page dropdown) and which cohort counts as "first listed" when `/` picks your Dashboard. The terminal is always last and pre-entry always first. **Level and display order are separate** (several classes can share a grade). | ✅ |
| D5 | 🔄 **A "QR code active" switch on each hidden group's row** (pre-entry and hand-over) in the **Group Names & QR Code Colors** panel. **Off:** the code is left off the QR Codes page and print view **for everyone, Admins included** (Q4), and scanning it says "This check-in code isn't active". **Defaults: pre-entry off, hand-over on.** The hand-over group keeps capturing attendance until its people are handed over, and then you turn it off. | ✅ |
| D6 | **Transition is blocked while the terminal still holds anyone.** It lists who is there and offers **"Archive them now"** (status becomes archived; records and attendance are kept). 🔄 **Space:** archived people stay in the same tables, so they use no extra space. Today the whole database is **47 MB of the free 500 MB**. All 1,047 prod youth records take about 1 MB, and all 5,180 attendance records about 2.9 MB. Archiving about 60 people a year adds well under 0.1 MB. Photos use 14 MB of the free 1 GB of storage. A **"Permanently delete people archived more than N years ago"** tool is listed for later (§10.5). | ✅ |
| D7 | Each regular group goes up one level. Groups at the top level move into the terminal. Pre-entry becomes level 1. The Admin creates a new pre-entry, as today. | ✅ |
| D8 | Servant, Coordinator and Read-Only grants of the groups entering the terminal **roll back to the new level 1**, as today. **New:** their youth assignments are cleared at the same time (on 29 Sep you had to clear 114 of these by hand in prod). | ✅ |
| D9 | The terminal is **renamed each year** from a per-ministry pattern, default `{cohort_year} - Transitioning` (e.g. "2003 - Transitioning"). | ✅ |
| D10 | **SAY one-time split** of "2004 & older" into "2004 - Yr 5", "2003 - Yr 6" and 🔄 **"2002 - Transitioning"** (the new hidden terminal; it already follows the terminal pattern, so next year it simply becomes "2003 - Transitioning"). QA first, rehearsal, then prod with your go-ahead (§5). | ✅ |
| D11 | **Cross-ministry hand-over** is a later phase (§10.1). Until then hand-over is manual: export the list, and the next ministry's Admin enters or imports it. | ✅ |
| **D12** 🔄 | **Hand-over grouping at transition.** When **two or more** groups graduate at once (High School's 4 classes), the transition asks how they enter hand-over: **one hand-over group** for all, **one per gender** (by each youth's gender), or **keep each class separate**. A ministry can therefore have **several** hand-over groups for a while. With only one group graduating (SAY), nothing is asked. §3.2, §4.2. | ✅ (your §3.2 comment) |
| **D13** 🔄 | **Shared check-in code.** A group can use another group's QR code instead of its own. The code then lists the names of **every** group sharing it, and each check-in is recorded for the person, wherever they are. **SAY:** "2003 - Yr 6" and "2002 - Transitioning" share the existing "2004 & older" code (which becomes "2004 - Yr 5"), so the current poster keeps working for all three and nothing is reprinted. §4.1, §4.4, §5.5. | ✅ (your Q8 / §5.5 comments) |
| **D14** 🔄 | **Coordinator's combined view.** A Coordinator on two or more groups gets a combined view of just those groups, as their **default landing** (High School: the male coordinator's 2 boys' classes). It is built automatically from their Coordinator grants, with no set-up. §4.6. | ✅ 🆕 (approach decided in Q10) |
| **O1** 🔓 | What to do with the **43 youths whose birth year is 2024–2026** (bad dates) and the **4 born 2005** in "2004 & older" | 🔄 **Provisional (you'll confirm):** the 43 → "2003 - Yr 6" (option A); the 4 born 2005 → **"2004 - Yr 5"** (§5.3) |
| **O2** 🔓 | Where the group's **grants and assignments** go: servants Kristeen Eshak (18 youths) and Mike Elgabalawi (16), plus 2 Read-Only grants | 🆕 **Provisional (you'll confirm), option E:** Kristeen and Mike become **Coordinators (and so also Servants) of both** Yr 5 and Yr 6, keep **all 34** assignments, and each gets a combined "Yr 5 + Yr 6" view. ✅ Ramez's and Amgad's Read-Only extends to Yr 6 (confirmed) (§5.4) |
| **Q3** ✅ | 🔎 SAY's name pattern says `{cohort_year} Cohort - Yr {position_label}`, but its groups are named "2008 - Yr 1" (no "Cohort"). The next transition would rename them "2008 Cohort - Yr 2". | 🔄 **Yes:** SAY's pattern becomes `{cohort_year} - Yr {level}`. The **Default name pattern** field sits at the **top** of the Group Names panel, and every new group starts from it (§4.5) |
| **Q4** ✅ | When a QR switch (D5) is **off**, should Admins still see that QR? | 🔄 **No:** off hides it from everyone. To print Yr 0's poster, switch it on first. |
| **Q5** ✅ | How Admins reach the hidden groups. Yr 0 is already the first entry in the Admin's cohort switcher (tagged "admin"). The hidden hand-over group(s) join the switcher the same way, **last before Combined**, tagged "admin". Nobody else sees them. | 🔄 **Yes** |
| **Q6** ✅ | 🔎 Moving a servant to another group **does not clear their old youths' assignments**. This is how prod "2006 - Yr 3" has **22 youths** assigned to people who don't serve there (10 to Ann Abdou, who holds no role at all, and 12 to Tony Sidrak, now a Yr 4 servant). | 🔄 **Yes:** a move clears them, after a warning with the count. The 22 existing ones are still your separate call (§10.5). |
| **Q7** ✅ | Your Connect2 list covers people **born 1996–2003**, but the split keeps **2003** in SAY as "2003 - Yr 6". | 🔄 **2003 stays in SAY.** The Connect2 list **excludes the 2003 cohort** (§10.4). |
| **Q8** ✅ | Colours and posters for the new groups (§5.5) | 🔄 **Colours are picked automatically** (distinct from the ministry's other groups and the Servants code). **One poster** for Yr 5, Yr 6 and the hand-over group, via the shared code (D13). |
| **Q9** ✅ | After a transition, where does the former pre-entry (the new level 1) appear in the list order? | 🔄 **First among the regular groups:** always Yr 0, Yr 1, Yr 2, Yr 3… |
| **Q10** ✅ 🆕 | How the coordinator's combined view (D14) is defined: **(a) automatically** from the person's Coordinator grants, or **(b)** an Admin-defined "class set" | **(a) automatic.** 🔎 Of SAY's current 8 prod Coordinators, none holds more than one Coordinator grant; with option E (§5.4), Kristeen and Mike would be the first. |
| **Q11** ✅ 🆕 | With a shared code (D13), which group does a **new sign-up** go into? | **By birth year.** Born in a sharing group's cohort year → that group (2004 → Yr 5, 2003 → Yr 6). Born earlier than every sharing regular group (≤ 2002) → the hand-over group. Born later than the youngest sharing group but not after the pre-entry's year (2005–2009) → the youngest (Yr 5). No birth date, or a year after the pre-entry's (e.g. 2024–2026) → the oldest regular group (Yr 6). These match the split's own rules (§5.1, O1). |
| **Q12** ✅ 🆕 | Someone who serves **both** the graduating group and a group that stays (option E: Kristeen and Mike on Yr 6 and Yr 5). Today's rule (D8) sends the graduating group's grants back to the new level 1, which would make them Coordinators of the new Yr 1 next September. | **Yes (decided):** **if the person still holds a grant on a regular group that stays, their graduating group's grants are dropped, not rolled back.** The preview lists each case. Everyone else follows D8 as today. |

---

## 2. Current state (verified)

Sources: read-only queries on `qa` and `prod` (30 Sep 2026); migrations 0028, 0030, 0033, 0047, 0064, 0066 and 0067; and every file in `web/src` that reads `ladder_position` or `display_order`.

### 2.1 The groups today

**Production (SAY):**

| Name | `ladder_position` | `display_order` | cohort_year | Active youths | Role grants | QR |
|---|---|---|---|---|---|---|
| 2009 - Yr 0 | 0 | **6** | 2009 | 0 | 0 | intake only |
| 2008 - Yr 1 | 1 | 0 | 2008 | 136 | 13 | check-in |
| 2007 - Yr 2 | 2 | 1 | 2007 | 167 | 18 | check-in |
| 2006 - Yr 3 | 3 | 2 | 2006 | 158 | 15 | check-in |
| 2005 - Yr 4 | 4 | 3 | 2005 | 193 | 15 | check-in |
| 2004 & older | 5 | 4 | 2004 | **393** | 4 (2 servants, 2 Read-Only) | check-in |
| 2003- Yr 5+ (archived) | 5 | 5 | 2003 | 0 | 0 | none |

**QA:**

| Ministry | Name | Level (`ladder_position`) | display_order | cohort_year | Active | Grants |
|---|---|---|---|---|---|---|
| SAY | 2009 - Yr 0 | 0 | 6 | 2009 | 0 | **1 servant** 🔎 |
| SAY | 2008 - Yr 1 | 1 | 0 | 2008 | 15 | 5 |
| SAY | 2007 - Yr 2 | 2 | 1 | 2007 | 169 | 20 |
| SAY | 2006 - Yr 3 | 3 | 2 | 2006 | 157 | 17 |
| SAY | 2005 - Yr 4 | 4 | 3 | 2005 | 188 | 14 |
| SAY | 2004 & older | 5 | 4 | 2004 | 391 | 13 (11 servants, 2 Coordinators) |
| SAY | 2003 - Yr 5+ (archived) | 5 | 5 | 2003 | 0 | 0 |
| TST | Incoming Students (pre-entry) | 0 | 1 | – | 0 | 0 |
| TST | 2026 - Grade 1 | 1 | 3 | 2026 | 4 | 0 |
| TST | 2026 - Grade 2 | 2 | 4 | **3** 🔎 | 0 | 0 |
| TST | 2026 - Grade 3 | 3 | 2 | 2025 | 2 | 1 Read-Only |

🔎 **TST today differs from the original description.** The groups were renamed after the "Grade 3" incident. The row that was "2025 Grade 2" (cohort 2025) now sits at level 3 and is named "2026 - Grade 3". The row added as "Grade 3" sits at level 2, is named "2026 - Grade 2" and has **cohort year 3** (probably typed into the year box). This is QA test data, so the migration leaves it alone; you can tidy it with the new controls.

🔎 **QA SAY "2009 - Yr 0" has a servant grant**, although pre-entry is meant to have none. The migration must deal with it first (§6, step Q0).

**Settings today:**

| | SAY (qa and prod) | TST (qa) |
|---|---|---|
| Level word (`ladder_position_label`) | Yr | Grade |
| Name pattern (`group_name_template`) | `{cohort_year} Cohort - Yr {position_label}` 🔎 (names don't match it, Q3) | `{cohort_year} - Grade {position_label}` |
| Coordinators become servants | on | off |

### 2.2 How it works today

| Concept | How it works today | Problem for the new direction |
|---|---|---|
| **Level** | `groups.ladder_position`: 0 = pre-entry, 1…N-1 = regular, **N = terminal**. The terminal is simply "the highest number". | Adding a group at the top has to push the terminal up, so the new group lands *below* the old top group. That's the TST bug: "Grade 3" landed at level 2. |
| **Display order** | `groups.display_order` exists and orders `getAccessibleGroups()` (`lib/groups.ts:31`). That order decides the "first listed" cohort `/` lands you on, but the side menu's switcher re-sorts by level (`lib/groups.ts:105`). New groups get "max + 1", so in prod Yr 0 is **6** (after the terminal), even though it's first in the ladder. Nothing keeps it tidy, and there is no way to move a group. | Order is accidental. |
| **Cohort year** | `unique (ministry_id, cohort_year)`, **including archived rows** | 🔄 **In plain words:** the database refuses a second group with the same cohort year in the same ministry, even when the first one is archived. **SAY:** last year's terminal, "2003- Yr 5+", is archived but still exists with cohort year **2003**. So creating "2003 - Yr 6" (also 2003) would be refused. **High School:** its 4 Grade 10 classes all started in the same year, so only the first could be created. The plan drops this rule (§3.3); the cohort year becomes bookkeeping only. |
| **One group per level** | `add_group_tier` and `run_group_transition` pick "the" group at a level with `limit 1` | Several classes per grade would be silently mishandled |
| **Pre-entry hidden** | Only the **group row** is hidden (`groups_select`: position 0 visible to Admins only). The side menu's switcher lists it for Admins only (`=== 0`, tag "admin"); every other list filters `ladder_position > 0`. | See §2.4: its youths are still readable by General Coordinators through the API |
| **Terminal** | A normal group, visible to everyone, with its own servants. At transition the old terminal's members are **merged** into the next one, its row is archived and its QR deleted. | Being replaced by a hidden, non-cumulative hand-over group |
| **Terminal name** | 🔎 `run_group_transition` (qa and prod, live) renames the new terminal `"{cohort_year} and earlier - Yr {N}+"`. REQUIREMENTS §2.2 says the name stays unchanged (migration 0033). **0033 removed the rename, but 0047 put it back** (it was built on 0030's text), and 0064 carried it forward. The preview screen (`lib/group-transition.ts:70-73`) still says "keeps its name", so **the preview and the real run disagree.** That is likely why prod needed manual renaming to "2004 & older". | Removed by the redesign |
| **Regular names** | At transition, every regular group with a cohort year is renamed from the ministry pattern | SAY's pattern doesn't match its names (Q3). High School needs a pattern per class ("Gr9 Boys St Anthony"). |
| **Grants at transition** | The old terminal's grants move to the new level 1. **Youth assignments are not cleared.** | 114 carry-over assignments cleaned by hand on 29 Sep (copy kept in `prod_premm_backup.assignment_cleanup_2026_09_29`, 114 rows) |
| **QR Codes page** | `get_qr_codes_with_groups()` returns **every** QR of the ministry to every approved user, sorted Servants, then by level. Yr 0's QR is shown to everyone. | No switches. REQUIREMENTS §6.15 still says "Yr 0 only for Admin/GC", which is out of date since migration 0040. |
| **Check-in** | The public check-in functions work from the QR code only, run with elevated rights and never look at level. Pre-entry's QR is `intake_only`. | None: the terminal QR will work as a normal check-in QR with no change |

### 2.3 Every code location that depends on the meaning of `ladder_position`

| File | What it assumes today | Change (§4.5) |
|---|---|---|
| `lib/groups.ts:34-35` | terminal = highest position (`is_terminal`) | Read `kind` |
| `lib/groups.ts:51, 69` | `> 0` means "a real cohort" (Combined view; `filterSelectableGroups`, used by the side menu and by `/`) | `kind = 'regular'` |
| `lib/groups.ts:103-111` (`buildSwitcherEntries`, side-menu cohort switcher) | pre-entry = `=== 0` (Admins, tag "admin"); list **sorted by position** | Pre-entry first and terminal last-before-Combined, both Admins only, tag "admin" (Q5); regular groups in **display order** |
| `lib/groups.ts:135` (`pickDefaultGroupId`, where `/` lands you) | read-only fallback sorted by position | Display order, regular groups only (a hidden group is never anyone's default) |
| `app/api/menu/route.ts` | serves the switcher list | No change of its own (uses `buildSwitcherEntries`) |
| 🔄 `app/g/[groupId]/layout.tsx:125` | Combined view only for Admin/GC | Also a Coordinator with 2+ Coordinator groups (D14, §4.6) |
| `lib/group-transition.ts` (whole file) | terminal = max; "one below terminal becomes terminal"; its own name computation | Replaced by a database preview function (§4.2) |
| `components/admin/GroupNamesInteractive.tsx:34, 100-109, 152-153` | terminal = max; shows "Yr N+"; "Yr 5+ becomes Yr 6+" help text | Rebuilt (§4.5) |
| `components/admin/GroupTransitionInteractive.tsx:87-146` | "becomes the new Yr N+", "absorbed into it" texts | Rebuilt (§4.5) |
| `app/admin/group-transition/actions.ts:18` | review-step groups `> 0` | regular only |
| `app/admin/access-maintenance/page.tsx:34`, `app/servant-assignments/page.tsx:35` | serving groups `> 0` (would include the terminal) | regular only |
| `app/page.tsx` | No longer a landing page: it only redirects via `pickDefaultGroupId` (or shows "No group assigned yet"). The old Yr 0 button is gone. | Nothing beyond `lib/groups.ts` |
| `app/admin/actions-needed-config/actions.ts:56-64` | Group Names list ordered by position | Order by display order; add kind, level, pattern, member count |
| `lib/qrcodes.ts:79` | sort by position | Sort by display order; pre-entry/terminal per switches |
| `lib/servant-assignments.ts`, `lib/servants.ts`, `lib/servant-directory.ts`, `ServantsDirectoryInteractive.tsx:56-71`, `ServantProfilesInteractive.tsx:46-59`, `ServantAssignmentsInteractive.tsx:97`, `AnalyticsInteractive.tsx:167, 203` | sort cohorts by position (ties unordered if several classes share a level) | Sort by display order |
| `app/export-lists/page.tsx` via `getCombinedGroups()` | `> 0` (currently includes "2004 & older") | Regular groups; Admins also get the terminal list (for manual hand-over) |
| `app/g/[groupId]/*` "All cohorts" views via `getCombinedGroups()` | `> 0` | Regular only (§4.5) |
| Console `CreateMinistryInteractive.tsx`, `app/console/actions.ts` | creates pre-entry only | Also terminal name, level offset (§4.2) |
| Database: `groups_select`, `add_group_tier`, `delete_group_tier`, `run_group_transition`, `get_qr_codes_with_groups`, `create_ministry` | position 0 / max position semantics, `limit 1` | §4.2–4.3 |

`app-settings.ts`, `ActionsNeededConfigInteractive.tsx` and the console read only the **label** `ladder_position_label` ("Yr"), which stays.

### 2.4 🔎 Hidden groups are hidden only on screen, not in the database

I read the live prod rules (0064 as changed by 0067):

| Table | Rule today (read) | Effect |
|---|---|---|
| `groups` | position 0: Admins only; everything else: any approved user | Only the Yr 0 **row** is hidden |
| `members` | `is_admin_or_general_coordinator()` **or** group in `accessible_group_ids()` | **General Coordinators can read every group's youths, including Yr 0.** Harmless today (Yr 0 has 0 youths) |
| `attendance_records`, `outreach_entries` | same pattern | Same: GCs read Yr 0 attendance/outreach |
| `members` insert/update, attendance insert/delete, outreach insert | GC branch = every group | A GC could **move a youth into or out of** a hidden group, or record attendance there |
| `accessible_group_ids()` (0067) | GCs ("every_group") and anyone with a grant at a group, **incl. a grant at Yr 0** | A servant granted at Yr 0 (QA has one) sees Yr 0 youths |
| `export_group_member_names()` | any Coordinator, any group | A Coordinator could export the hidden groups' names |
| `add_member_photo()`, `has_group_access()` | GC = every group | Same gap |

Once the terminal holds real people (63 in SAY) and children's ministries join, "admin only" must be enforced **in the database**, not just by hiding buttons. The public check-in functions don't depend on these rules (they run with elevated rights from the QR code), so the terminal's QR keeps working after the change (§4.4).

---

## 3. Target model

### 3.1 The model in one table

| Group kind | How many | Level | Display order | Who can see its people | QR | Attendance |
|---|---|---|---|---|---|---|
| **pre_entry** | exactly 1 per ministry | 0 (fixed) | always first | Admins and Church Admin only | intake only; 🔄 active per its switch (default **off**) | none (unchanged) |
| **regular** | any number; **several may share a level** | 1…N, no gaps | admin-chosen (up/down) | normal rules (servants, Coordinators, GCs, Read-Only) | check-in + intake; 🔄 its own code or a shared one (D13) | yes |
| **terminal** (hand-over) | 🔄 at least 1 per ministry, **permanent**; more while D12's "per gender" / "separate" groups wait for hand-over | none shown (stored as N+1 internally) | always last | Admins and Church Admin only | check-in + intake; 🔄 active per its switch (default **on**); own or shared code | yes (QR) |

**Level display** = level + the ministry's **number offset**, after its **level word**:

| Ministry | Level word | Offset | Levels 1…N display as |
|---|---|---|---|
| SAY | Yr | 0 | Yr 1 … Yr 6 |
| High School (future) | 🔄 Gr | 8 | Gr9 … Gr12 (no space: the pattern decides spacing) |
| TST (QA) | Grade | 0 | Grade 1 … Grade 3 |

**Names.** Each group may carry its own **name pattern**, re-applied at every transition. A group with no pattern keeps its name forever (the 0033 principle). Placeholders:
- `{level}`: the displayed number (level + offset)
- 🔄 `{label}`: the ministry's level word ("Yr", "Gr")
- `{cohort_year}`: the group's cohort year
- `{position_label}` stays accepted as an old spelling of `{level}`

Examples:
- SAY: `{cohort_year} - Yr {level}` → "2008 - Yr 1" becomes "2008 - Yr 2"
- 🔄 High School: `{label}{level} Boys St Anthony` → "Gr9 Boys St Anthony" becomes "Gr10 Boys St Anthony". Only the grade number changes; the saint's name stays.
- Terminal: the ministry's **terminal name pattern**, default `{cohort_year} - Transitioning`

The ministry's existing `group_name_template` becomes the **default pattern** pre-filled when you add a group or create the new pre-entry. 🔄 For High School the default would be `{label}{level} Boys St ...`, and you'd finish each class's saint name when adding it.

### 3.2 What the transition does (SAY example, next September, after the split)

| Before | After |
|---|---|
| 2002 - Transitioning (terminal, 63) | **Blocked** until it's empty: the screen lists the 63 and offers "Archive them now" (or you archive/hand over earlier) |
| 2003 - Yr 6 (top level) | Its youths move into the terminal, which is renamed **"2003 - Transitioning"**. Their assignments are cleared. Its grants move to the new Yr 1. The empty row is archived and its QR removed. |
| 2004 - Yr 5 … 2008 - Yr 1 | Each goes up one level and is renamed from its pattern ("2004 - Yr 6" … "2008 - Yr 2"). Same row, colour, QR code and servants. |
| 2009 - Yr 0 (pre-entry) | Becomes regular level 1, "2009 - Yr 1". Its QR switches to check-in. It takes the colour of the group that just left (the Yr 6 colour), as today's colour relay. |
| (new) | New pre-entry "2010 - Yr 0", year suggested +1, name editable, intake-only QR |

🔄 High School (later): the **four** Gr12 classes graduate together, so the transition asks how they enter hand-over (D12):

| Choice | Result (example year 2027) |
|---|---|
| **One hand-over group** | All four classes' youths move into the permanent hand-over group, renamed "2027 - Transitioning" |
| **One per gender** | Two hand-over groups, "2027 - Transitioning Boys" and "2027 - Transitioning Girls", filled by each youth's gender (every youth record has Male/Female; anyone without one is listed so you can place them) |
| **Keep each class separate** | Four hand-over groups, each named from the class ("2027 - Transitioning Gr12 Boys St Anthony"…) |

All suggested names are editable in the preview. The one-group-per-level limit is gone. The block rule (D6) covers every hand-over group: the next transition waits until all of them are empty. Emptied extra hand-over groups are then archived, and the ministry keeps its one permanent hand-over group.

### 3.3 Why these choices (and the alternatives)

| Choice | Why | Alternative rejected |
|---|---|---|
| An explicit **`kind`** column | "Terminal = highest number" is what caused the TST bug and the "+" logic. An explicit kind can't be confused by adding groups. | Keep inferring from numbers: the bug stays |
| **Keep the column `ladder_position`** as the level (screens say "level") | The app code keeps working unchanged in the minutes between the database change and the code deploy (the terminal is still the highest number, stored as N+1). No mass rename of every query. | A new `level` column and dropping `ladder_position`: cleaner name, but breaks the running app during deploy for no user benefit. Can be renamed later. |
| **Reuse `display_order`** for list order | Already exists and already decides the "first listed" cohort (`/` and the side menu); it just needs tidying and up/down controls | A new column: duplication |
| **A permanent terminal row** (people move into it) | Several top groups (High School's 4 classes) can enter one terminal (🔄 or, by your choice at transition, one per gender or per class, D12). Its QR is printed once and stays valid. One hidden row per ministry, easy to protect. | Today's "the top row *becomes* the terminal": only one row can become it, and the terminal QR changes every year |
| **A name pattern per group** | High School's saint names differ per class; SAY's are uniform. Neither can be served by one ministry template. | One template per ministry: can't express "{label}{level} Boys St Anthony" |
| **Drop cohort-year uniqueness** | Classes share a year, and archived rows would block reuse. Cohort year becomes bookkeeping only. **Active names** stay unique per ministry (checked by the functions). | Keep it: blocks the split and High School |
| **Hidden = enforced in the database** | Your hard-wall principle. Children's records. A forgotten filter in a screen can't leak. | Screen-only hiding (today's gap, §2.4) |
| **The preview is computed by the database**, using the same logic as the run | The current preview and run already disagree (the terminal-name regression) | Keep two copies of the logic |

---

## 4. Change specification

All changes are in one migration, **`0069_group_ladder.sql`** (+ `0069_down_group_ladder.sql`), run once per schema as one transaction. The SAY data split is a separate script, **`0070_say_terminal_split.sql`** (§5). **No new tables** are created, so the Supabase grants change (30 Oct) doesn't apply. Backup tables go into the existing `qa_premm_backup` / `prod_premm_backup` schemas, which the API can't reach. **No new audit action types** are added: the split reuses `GROUP_TRANSITION_RUN` (with details), and archiving reuses the existing, so far unused, `MEMBER_ARCHIVED`. So the migration needs no enum change and can stay one transaction.

### 4.1 Table and column changes

**`groups`**

| Change | Detail |
|---|---|
| **new** type `group_kind` = `pre_entry` / `regular` / `terminal` | – |
| **new** `kind group_kind not null` | Backfill: active level 0 → `pre_entry`; everything else (incl. archived rows) → `regular` |
| **new** `name_pattern text` (nullable) | Backfill: SAY's regular and pre-entry groups get SAY's corrected pattern (Q3); TST's get TST's template; archived rows stay NULL |
| **new** check | `kind='pre_entry' → ladder_position = 0`; `kind='regular' → ladder_position ≥ 1`; `kind='terminal' → ladder_position ≥ 1` |
| **new** partial unique index | one active `pre_entry` per ministry. 🔄 (No "one terminal" index: D12 allows several for a while. The functions check there is at least one.) |
| 🔄 **new** `qr_active boolean not null default true` | The D5 switch. Only pre-entry and hand-over rows can be switched off; regular groups are always on. Backfill: **pre-entry false** (SAY's Yr 0 and TST's), hand-over true. |
| 🔄 **new** `check_in_code_group_id` (nullable, same ministry) | D13: "use this group's QR code instead of my own". Null = own code. A group sharing a code has no QR row of its own. A code can only be shared by groups of the same ministry, and never chains (a sharer can't lend its code on). |
| **drop** `unique (ministry_id, cohort_year)` | Replaced by a plain index on `(ministry_id, cohort_year)` |
| **new** index `(ministry_id, kind, ladder_position) where not is_archived` | The old `idx_groups_ladder_position` (no ministry) is dropped |
| **backfill** `display_order` | Per ministry: pre-entry = 1, regular groups 2…N+1 in their current order (current display order, then level), terminal last. Prod SAY becomes Yr 0, Yr 1, Yr 2, Yr 3, Yr 4, 2004 & older, then the terminal. 🔄 After the split (§5): **Yr 0, Yr 1, Yr 2, Yr 3, Yr 4, Yr 5, Yr 6, then "2002 - Transitioning"**. |
| **create the terminal** | For every ministry, one empty terminal row. **SAY:** name "2002 - Transitioning", cohort 2002, 🔄 colour picked automatically; it gets the shared code in the split (§5). **TST:** "Transitioning", with its own check-in QR. Level = highest regular level + 1 (SAY 6, TST 4). Because it starts empty, **nobody loses or gains access to any youth** when 0069 runs; only the split (§5) moves people. |

**`app_settings`** (per ministry)

| New column | Default | SAY | Where edited |
|---|---|---|---|
| `level_number_offset smallint not null` (0–50) | 0 | 0 | App Labels panel, next to the level word |
| `terminal_name_pattern text not null` | `{cohort_year} - Transitioning` | default | Group Names panel |
| `group_name_template` (existing) | – | 🔄 → `{cohort_year} - Yr {level}` (Q3 ✅) | 🔄 Group Names panel, **at the top** ("Default name pattern") |

🔄 The two QR switches moved from here to the group rows (`groups.qr_active` above), because a ministry can now have several hand-over groups (D12).

**`user_roles`**: new trigger `user_roles_no_hidden_group`. Any role grant pointing at a pre-entry or terminal group is refused, whoever writes it (Access Maintenance writes `user_roles` directly, not through a function).

### 4.2 Function changes

Every function keeps the Project B rules: the current ministry only, role checked in that ministry, pinned `search_path`, dropped and recreated if its arguments change.

| Function | Today | New behaviour |
|---|---|---|
| `add_group_tier` → **`add_group(p_name, p_level default null, p_cohort_year, p_qr_color, p_name_pattern)`** (drop + recreate) | Inserts at the terminal's position and pushes the terminal up (so it lands below the previous top group); `limit 1` | Always a **regular** group. `p_level` null = **a new top level** (N+1); otherwise joins an existing level 1…N (a second class at Grade 10). Always placed **last in display order, just before the terminal**. The terminal's stored level moves to N+2 if needed. Checks the name is unique among active groups. Creates its check-in QR. 🔄 `p_qr_color` null = **pick automatically**: a colour from a fixed list of well-separated colours that no active group and not the Servants code is using (you can change it afterwards with the colour dot). |
| `delete_group_tier` | Refuses pre-entry/terminal; shifts every higher position down | Regular groups only, with no active youths and no grants (as today). **Only if that level becomes empty** are higher levels shifted down. Display order is re-tidied. |
| `rename_group` | Renames group + QR label | Same, plus the unique-name check. Works on pre-entry and terminal too. |
| **new** `move_group(p_group_id, p_direction)` | – | Swaps display order with the neighbouring regular group (up/down). Pre-entry and terminal can't move. |
| **new** `set_group_level(p_group_id, p_level)` | – | Moves a regular group to another level (e.g. fix TST's swapped Grade 2/3). Gaps are closed automatically so levels stay 1…N. |
| **new** `set_group_name_pattern(p_group_id, p_pattern)` | – | Sets or clears a group's yearly pattern (must contain `{level}` or `{cohort_year}`, or be empty) |
| 🔄 **new** `set_group_qr_active(p_group_id, p_active)` | – | Admin only. The D5 switch, for pre-entry and hand-over groups |
| 🔄 **new** `set_group_check_in_code(p_group_id, p_code_group_id)` | – | Admin only. D13: share another group's code (or null = back to its own; a new own code is then created). Same ministry, no chains, the owner must be active. |
| **new** `preview_group_transition(p_new_pre_entry_cohort_year, 🔄 p_handover_mode)` | Preview computed in TypeScript (differs from the run, §2.2) | Returns exactly what the run will do: each group's old/new name and level; the terminal's occupants (count + names, **blocking** if any are active); the suggested terminal name(s) 🔄 (one, per gender, or per class, D12); the suggested pre-entry name; the grants that roll back; and the **number of assignments that will be cleared, per servant**. `run_group_transition` uses the same internal steps. |
| **new** `archive_terminal_members()` | – | Admin only. Sets every **active** youth in the terminal 🔄 group(s) to `archived`, clears their assignment, writes one `MEMBER_ARCHIVED` audit entry with the count and ids. Records, attendance and outreach are untouched. Archived youths stay in the terminal group (hidden) as history. |
| `run_group_transition(new_pre_entry_cohort_year)` → **`run_group_transition(p_new_pre_entry_cohort_year, p_new_pre_entry_name, p_new_terminal_names, 🔄 p_handover_mode)`** (drop + recreate) | Merges old terminal into the group below, archives it; **renames the new terminal "{year} and earlier - Yr N+"**; `limit 1`; doesn't clear assignments | See the steps below. 🔄 `p_handover_mode` = `one` / `by_gender` / `separate`, only asked when two or more groups graduate. |
| `get_qr_codes_with_groups()` | All QRs for any approved user | Adds `kind`, `display_order` 🔄 and the names of every group sharing each code. Leaves out codes whose `qr_active` switch is off, 🔄 **for everyone, Admins included** (Q4 = No). Sorted Servants, then display order. |
| `create_ministry(...)` / `apply_ministry_settings` | Creates pre-entry only | Also creates the **terminal** (name from a new "terminal group name" field) with its check-in QR. Accepts the 🔄 two new settings (first level number, terminal name pattern). The pre-entry starts with its QR switched **off**. |
| `accessible_group_ids()`, `has_group_access()`, `has_readonly_or_full_group_access()` | GC = every group; any grant counts | GC = every **regular** group; grants count only at regular groups; Admin/Church Admin = every group (§4.3) |
| `export_group_member_names()` | Any Coordinator, any group | Hidden groups: Admins only |
| `grant_servant_role()`, `reassign_role_group()` | Any group | Refuse hidden groups. 🔄 **Q6 = yes:** `reassign_role_group` also clears that servant's assignments in the group they're leaving (the screen warns first with the count). |
| Check-in functions (16) | Work from the QR token, one group per code | 🔄 **Small change (D5, D13).** Security is unchanged (still token first, still one ministry). What changes: (1) a code whose group's switch is off answers "This check-in code isn't active"; (2) a shared code lists and accepts the youths of **every active group sharing it** (skipping groups switched off), and attendance is recorded for the person as today; (3) 🆕 a new sign-up through a shared code is placed by **birth year** among the sharing groups (Q11's rule); (4) the "Is this you?" step never moves someone between groups that share the code. Verified in §7 (V8). |

**`run_group_transition` steps (all in one transaction; any failure undoes everything, as today):**
1. Admin check. Lock the ministry's group rows so a double click can't run it twice.
2. Check the ladder: exactly one pre-entry, 🔄 at least one terminal, levels 1…N with no gaps, N ≥ 1. Otherwise stop with a plain message.
3. **Block** if 🔄 any hand-over group has an active youth: "The hand-over group still has 63 people. Archive them or hand them over first." 🔄 Emptied extra hand-over groups (from D12) are archived here; the permanent one stays.
4. The top-level group(s) (level N): move **all** their youths (active and archived) into the terminal, 🔄 or, for `by_gender` / `separate` (D12), into new hand-over groups created now (same switch and colour rules as a new group). Clear those youths' assignments. Move their grants to the former pre-entry (duplicates are dropped rather than failing, which matters when one person holds the same role in two top classes). 🆕 **Q12 ✅:** a person who also holds a grant on a regular group that stays has their graduating group's grants **dropped** instead of moved. Delete their QR codes 🔄 (if a leaving group **owns a shared code**, the code passes to the hand-over group instead, so the poster keeps working). Archive the empty rows. Remember the first one's colour.
5. Every other regular group: level + 1, renamed from its pattern if it has one.
6. The pre-entry: becomes regular level 1, QR switched to check-in, renamed from its pattern, placed first among the regular groups (Q9).
7. The terminal: renamed to `p_new_terminal_name` (the preview suggests it from the pattern, with `{cohort_year}` = the entering groups' cohort year when they share one). Its cohort year is set to theirs. It keeps its QR code, colour and stored level (N+1).
8. New pre-entry: `p_new_pre_entry_name`, the given cohort year, the ministry's default pattern, the relayed colour, intake-only QR 🔄 switched **off**, display order first.
9. Also clear the assignments of youths whose servant's grant was just moved (step 4). Other groups' existing assignments are **not** touched.
10. Refresh QR labels. Write `GROUP_TRANSITION_RUN` with the counts: moved, cleared, grants moved, groups renamed.

### 4.3 Security rule (RLS) changes

"Hidden" = `kind in ('pre_entry','terminal')`. Admin = `is_admin()` (Church Admin included). The ministry condition from Project B stays on every rule.

| Rule | Today | New |
|---|---|---|
| `groups_select` | `(position 0 and admin) or (position > 0 and (app user or group access))` | `(hidden and admin) or (regular and (app user or group access))` |
| `members_select` | `admin_or_GC or group in accessible_group_ids(true)` | `admin or group in accessible_group_ids(true)` |
| `members_insert`, `members_update` | `admin_or_GC or group in accessible_group_ids(false)` | `admin or group in accessible_group_ids(false)`. For updates the check also applies to the **new** group, so a GC can't move a youth into a hidden group. |
| `members_delete` | `admin_or_GC` | `admin or (admin_or_GC and group in accessible_group_ids(false))` |
| `attendance_select/insert/delete` (member rows) | `admin_or_GC or member's group in accessible_group_ids(...)` | `admin or member's group in accessible_group_ids(...)`. Servant attendance rows unchanged. |
| `outreach_select/insert` | same pattern | `admin or …` (update/delete stay "your own entries") |
| `qr_codes_write` | `admin_or_GC` | Hidden groups' QR rows: Admin only |
| `accessible_group_ids(p)` | Church Admin, GC, or grant → all groups/granted groups | Church Admin / Admin → all groups; **GC → all regular groups**; grant → granted **regular** groups only |

**What people will notice:** General Coordinators, Coordinators, servants and Read-Only stop seeing pre-entry and terminal youths, their attendance and outreach, anywhere in the app and the API. Today that is 0 people (Yr 0 is empty and the terminal starts empty); after the split it is the 63 in "2002 - Transitioning". **Admins and the Church Admin see everything, as today.** Speed: GCs now go through the same list lookup servants already use (0067); the list holds about 8 groups, so no slowdown is expected (measured in V6).

### 4.4 Check-in impact

- **Terminal QR:** a normal check-in QR. Youths in "2002 - Transitioning" find their name and check in exactly as in "2004 & older" today. Prod shows **25 of the 63** checked in during the last 12 months (59 check-ins), so this matters. 🔄 In SAY they use the **same poster as today** (shared code, D13). After their hand-over, you switch the hand-over group's QR off and they drop out of the list.
- 🔄 **Shared code (D13):** the check-in list shows the names of all groups sharing the code (SAY: Yr 5, Yr 6 and the hand-over group, about 390 names, the same number as "2004 & older" today). Attendance is stored against the person, so it doesn't matter which of the three groups they're in.
- **Pre-entry QR:** unchanged (intake only), 🔄 but switched off by default. Switch it on when you want to print or use it.
- **Archived youths** are no longer listed at check-in (the functions list active youths only). If one comes back, the duplicate check won't find them either, so they'd register as new. Acceptable for now; an "unarchive" tool is a later item (§10).
- **"Is this you?" duplicate step:** it can move a person into the group whose QR they scanned (today's behaviour, only after they confirm). So a terminal person scanning a regular poster could move themselves back into a regular group. 🔄 With the shared code this can't happen between Yr 5, Yr 6 and the hand-over group: the step never moves someone between groups that share the code.

### 4.5 App changes

| Screen / file | Change |
|---|---|
| **App Settings → "Group Names & QR Code Colors" panel** (`GroupNamesInteractive.tsx`, `actions-needed-config/actions.ts`) | 🔄 **At the top: "Default name pattern"** (e.g. `{cohort_year} - Yr {level}`), with a live example; every new group starts from it. Then one list in display order. Each row shows: ▲/▼ (regular only), name, its QR colour dot (as built on 30 Sep, with the Servants row at the bottom), level ("Yr 3" / "Gr10"), a tag ("Pre-entry · hidden from servants" / "Hand-over · hidden from servants"), active youths, Rename, "Change level", "Yearly name pattern", Delete (regular only). 🔄 **On the pre-entry and hand-over rows, next to the colour dot: a "QR code active" switch** (D5). 🔄 **A row that shares a code** shows "Uses the 2004 - Yr 5 code" instead of its own dot, with a "Use another group's code / Use its own code" choice (D13). **No "+" anywhere.** **Add Group:** name (required, pre-filled from the default pattern), level (dropdown: existing levels or "New top level: Yr 7", default new top level), cohort year (optional), 🔄 colour (picked automatically, changeable), yearly name pattern (pre-filled from the default pattern). It is always added at the end, just before the terminal. Below the list: the terminal name pattern. |
| App Labels panel (`ActionsNeededConfigInteractive.tsx`) | "Level word" (existing) + **"Number of the first level"** (stored as offset; e.g. first level 9 → offset 8) with a live example "Levels display as Grade 9, Grade 10…" |
| **Group Transition** (`GroupTransitionInteractive.tsx`, `app/admin/group-transition/*`, `lib/group-transition.ts`) | Preview from `preview_group_transition()`. **If the terminal isn't empty:** a red box "The hand-over group '2002 - Transitioning' still has 63 people", their names, **Export list** (for the next ministry) and **Archive them now** (confirm, then refresh). The Transition button stays disabled until it's empty. Otherwise it shows: 🔄 (when two or more groups graduate) the D12 choice "One hand-over group / One per gender / Keep each class separate"; each group old → new name and level; which groups enter hand-over and the new name(s) (editable); the new pre-entry's year and name (editable); "N grants move to [new Yr 1]"; "**N youth assignments will be cleared**" per servant. Then the two-step confirm, as today. The completion screen keeps "reprint QR codes" (new tab) and the optional **Review Servant Assignments** step, listing regular groups only, with the grants that just moved highlighted. |
| Side menu cohort switcher and default cohort (`lib/groups.ts`: `buildSwitcherEntries`, `pickDefaultGroupId`, `filterSelectableGroups`) | Switcher: regular groups in **display order** for everyone (each person sees only the ones they can open), then Combined. For Admins, pre-entry first and the hand-over group(s) last before Combined, all tagged "admin" (Q5 ✅). `/` never lands anyone on a hidden group. 🔄 Coordinators with two or more Coordinator groups: see §4.6. |
| "All cohorts" views and Export Lists (`getCombinedGroups`) | Regular groups only. Admins also see the terminal in Export Lists. **Visible change:** the 63 "2002 - Transitioning" youths leave the All-cohorts dashboard/analytics totals. |
| QR Codes page + print view (`lib/qrcodes.ts`, `QrCodesInteractive.tsx`) | Order: Servants, then display order. 🔄 Pre-entry/hand-over codes shown only when their switch is on, for everyone (Q4 = No). A shared code appears once, under its own group's name, with "Also used by 2003 - Yr 6" underneath (the hidden group's name is shown to Admins only). |
| Access Maintenance → Servant move (`reassign_role_group`) | 🔄 Q6: before moving a servant, "This will clear N youth assignments in 2006 - Yr 3. Continue?" |
| Access Maintenance, Servant Assignments, post-transition review | Group pickers list regular groups only |
| Servant Directory, Servant Profiles, Analytics, Assignments | Sort by display order instead of level |
| Console: Create Ministry | New fields: terminal group name, level word, first level number, default name pattern |
| Member detail (Admins, hidden groups) | Optional small add: an "Archive" button for one person (Q in §10) |

Size estimate: 1 migration (+ down), 1 data script (+ down), roughly 🔄 18 app files. The Group Names panel and the Group Transition screen are the largest.

### 4.6 🔄 Coordinator's combined view (D14, new)

**Today:** the Combined ("All cohorts") entry is only for Admins and General Coordinators (`app/g/[groupId]/layout.tsx:125`). A Coordinator lands on their first listed group.

**New (Q10 option a, 🆕 decided; naming confirmed):**
- A Coordinator who holds a **Coordinator grant on two or more regular groups** gets a Combined entry covering **exactly those groups**. Groups where they are only a servant or Read-Only aren't included.
- It's their **default landing** (`/`), and it sits at the top of their switcher, above their individual classes.
- **Name:** the leading words the class names share, without a dangling "St"/"St.", e.g. "Gr10 Boys St Anthony" + "Gr10 Boys St Moses" → **"Gr10 Boys"**. 🆕 If they share no leading words, the levels joined in display order: "2004 - Yr 5" + "2003 - Yr 6" → **"Yr 5 + Yr 6"**.
- It shows the same Combined pages GCs have today (Dashboard, Analytics, lists), limited to those groups. The database rules don't change: a Coordinator can already read both classes.
- It moves up with them automatically, because their grants follow the class rows at each transition.
- **Speed:** building it automatically is **not slower** than a stored setup. The app already loads each person's grants to draw the side menu, and the combined pages read the same 2 classes a stored set would.
- **SAY:** 🔎 each of SAY's 8 prod Coordinators holds exactly **one** Coordinator grant, so nothing changes for them. 🆕 With option E (§5.4), **Kristeen and Mike** become Coordinators of Yr 5 and Yr 6 and each gets "Yr 5 + Yr 6" as their default view. The two cohorts stay separate groups everywhere else (their own lists, QR, transition).

**Changes:** `buildSwitcherEntries`, `pickDefaultGroupId` and `getCombinedGroups` in `lib/groups.ts` (a "coordinator scope" of groups), and the Admin/GC guard in `app/g/[groupId]/layout.tsx` (allow a Coordinator whose scope has 2+ groups). Checked in V11.

🆕 **Option b (Admin-defined "class sets") was not chosen** (Q10).

---

## 5. SAY one-time split of "2004 & older"

### 5.1 The numbers (verified 30 Sep 2026, active youths)

| Birth year | **Prod** | Assigned (prod) | **QA** | Goes to |
|---|---|---|---|---|
| 2004 | **148** | 28 | 147 | 2004 - Yr 5 |
| 2003 | **78** | 0 | 78 | 2003 - Yr 6 |
| none | **57** | 6 | 60 | 2003 - Yr 6 |
| ≤ 2002 | **63** | 0 | 60 | **2002 - Transitioning** (hidden terminal) |
| 2024–2026 (bad dates: 39 / 3 / 1) | **43** | 0 | 43 | 🔄 2003 - Yr 6 (🔓 O1, provisional) |
| 2005 | **4** | 0 | 3 | 🔄 2004 - Yr 5 (🔓 O1, provisional) |
| **Total** | **393** | 34 | 391 | |

🔄 **Prod result with the provisional O1 answer:** "2004 - Yr 5" = 148 + 4 = **152**; "2003 - Yr 6" = 78 + 57 + 43 = **178**; "2002 - Transitioning" = **63**. Total 393. Assigned: 34 = Kristeen Eshak 18 (15 born 2004, 3 no date) + Mike Elgabalawi 16 (13 born 2004, 3 no date); 359 unassigned. QA was **not** cleaned on 29 Sep: its "2004 & older" still has 161 assignments and 13 grants, so the QA run tests the mechanics, not prod's exact outcome.

### 5.2 What the script does (`0070_say_terminal_split.sql`, SAY only, runs after 0069)

1. **Checks** (else it stops): ministry SAY; "2004 & older" active, regular, level 5; "2002 - Transitioning" is the empty terminal; the counts match the rehearsal's (so a youth who registers between rehearsal and the real run is noticed, not mis-filed).
2. **Backup** into `<schema>_premm_backup.say_split_<date>`: every affected youth's group, assignment and new-assignment flag; the group's grants, groups rows and QR rows.
3. **Keep the existing row as "2004 - Yr 5"**: renamed, pattern `{cohort_year} - Yr {level}`, same colour (green `#4EB132`), same grants, 🔄 **same QR row and token** (label updated), so the current poster keeps working.
4. **Create "2003 - Yr 6"**: regular, level 6, cohort 2003 (possible once the old uniqueness is dropped; the archived "2003- Yr 5+" row is left untouched), pattern, 🔄 colour picked automatically, placed after Yr 5, 🔄 **sharing Yr 5's code** (no QR of its own). The terminal's stored level becomes 7.
5. 🔄 **Point "2002 - Transitioning" at Yr 5's code too** (its own unused QR row from 0069 is removed), switch on.
6. **Move youths** by the table above, with O1's answer applied.
7. **Grants and assignments** per O2 (§5.4). Any moved youth whose assigned servant doesn't serve their new group has the assignment cleared (and it's listed in the report). 🔄 With the provisional O2 answer that's **none**: Kristeen and Mike serve both groups.
8. Write one `GROUP_TRANSITION_RUN` audit entry marked "one-time split" with all counts.
9. **Self-checks** (else everything is undone): 393 youths before = after; per-group counts as rehearsed; each youth's attendance and outreach counts unchanged (they belong to the person, not the group: 648 attendance records in the last 12 months and 115 outreach entries follow their people); no assignment points at a non-servant of the youth's group; the terminal has no grants; 🔄 the shared code lists exactly the youths of Yr 5, Yr 6 and the hand-over group.

### 5.3 🔓 O1 options (43 bad dates, 4 born 2005)

| Option | 43 bad dates (2024–2026) | 4 born 2005 |
|---|---|---|
| **A** | Treat like "no birth date" → "2003 - Yr 6" | Move to "2005 - Yr 4" (their birth year's cohort) |
| **B** | Keep in "2004 - Yr 5" | Keep in "2004 - Yr 5" |
| **C** | → "2003 - Yr 6", plus an export list for servants to correct the dates later | Your choice per person |

My suggestion is A or C (bad dates were probably today's date typed at intake). Your Connect2 work already listed these as "Incorrect Year" (42 there).

🔄 **Your provisional answer (to confirm):** the 43 bad dates → "2003 - Yr 6" (option A); the 4 born 2005 → **"2004 - Yr 5"** (not Yr 4).

### 5.4 🔓 O2 options (the 4 grants and 34 assignments)

Facts: Kristeen's and Mike's assigned youths are **28 born 2004 + 6 with no date**. The 2 Read-Only grants belong to **Ramez Tawfik** (servant at Yr 4, Read-Only on Yr 1–3) and **Amgad Hakim** (servant at Yr 1, Read-Only on Yr 2–4). They're cross-year viewers, not servants of this group. The terminal can hold **no grants** in the new model.

| Option | Kristeen and Mike | Their 6 no-date youths (default rule → Yr 6) | Ramez's and Amgad's Read-Only |
|---|---|---|---|
| **A (suggested)** | Stay on "2004 - Yr 5" (same row, nothing changes for them) | Assignment cleared (listed for you), **or** kept in Yr 5 as an exception | Read-Only on "2004 - Yr 5" kept, **plus** a new Read-Only on "2003 - Yr 6" |
| **B** | Move to "2003 - Yr 6" | Keep them; their 28 born-2004 youths are cleared instead | Same as A |
| **C** | Stay on Yr 5 | Cleared | Read-Only on Yr 5 only |
| 🔄 **D (your provisional answer)** | **Servants on both** "2004 - Yr 5" and "2003 - Yr 6" | **All 34 assignments kept**: the 6 no-date youths move to Yr 6 with their servant, who now serves there too | ✅ 🆕 Read-Only on Yr 5 kept, plus Read-Only on Yr 6 (confirmed) |
| 🆕 **E (your idea, now the provisional answer)** | **Coordinators of both** Yr 5 and Yr 6. SAY's "Coordinators automatically become servants" setting (on) also gives them a **Servant** grant on each, so they stay in both groups' assignment lists. Each gets a combined **"Yr 5 + Yr 6"** view as their default (§4.6). | **All 34 assignments kept**, as in D | Same as D |

🆕 **What Coordinator adds beyond D** (REQUIREMENTS §4.1), limited to Yr 5 and Yr 6: they can assign and unassign youths among those groups' servants, and they get the Coordinator Corner pages (Servant Profiles, Servant Assignments, Servant Attendance, Print/Export Lists). They still can't move or remove servants; that stays with General Coordinators and Admins. They show as "Coordinator" in the servant lists.

🔄 With D or 🆕 E, "2003 - Yr 6" (178) starts with Kristeen and Mike as its servants. You may still want to add more in Servant Assignments before the next Friday. The pre-cleanup copy of the 114 assignments removed on 29 Sep (`prod_premm_backup.assignment_cleanup_2026_09_29`) is available if you want any restored after the split. That would be a separate step, only with your OK.

### 5.5 🔄 Q8 ✅: colours, QR codes and posters

"Posters" means the **printed QR code sheets** put up at the check-in point.

- **Colours:** picked automatically for "2003 - Yr 6" and "2002 - Transitioning", distinct from the other SAY groups and the Servants code (A8). Change them afterwards with the colour dots if you like. Yellow `#F5D447` (the old Yr 5+ colour) is taken by "2009 - Yr 0", so it won't be picked.
- **One code, one poster:** "2004 - Yr 5" keeps the existing "2004 & older" code, and "2003 - Yr 6" and "2002 - Transitioning" share it (D13). **The poster already up keeps working** for all three groups. Nothing needs reprinting, though you may want to reprint it with the new name "2004 - Yr 5" (the label on the sheet is the only thing that changes).
- **Why this also removes the mis-filing risk:** a 2003-born youth scanning the old poster finds their name in the list (it covers all three groups), so they don't register again and aren't moved into Yr 5.
- **Next September:** Yr 5 becomes Yr 6 and still owns the code; the old Yr 6 youths move into hand-over and keep using it. When "2004 - Yr 6" itself graduates (2028), the code passes to the hand-over group (§4.2 step 4), so the poster still works.

### 5.6 What servants and coordinators will notice

- "2004 & older" disappears; "2004 - Yr 5" and "2003 - Yr 6" appear in the side menu's cohort switcher, after Yr 4. 🔄 Kristeen and Mike see both. 🆕 With option E they land on their combined "Yr 5 + Yr 6" view, listed above the two groups in their switcher.
- 🔄 Kristeen and Mike keep all their youths: 28 in Yr 5, 6 in Yr 6.
- The 63 older youths disappear for everyone except Admins. GCs lose them from the All-cohorts views.
- 🔄 The QR page shows the same "2004 & older" code, now labelled "2004 - Yr 5" ("Also used by 2003 - Yr 6"). Yr 0's code is **no longer shown** (its switch starts off); turn it on when you need it.
- Youths check in exactly as before, on the same poster.
- Nothing changes for Yr 1–Yr 4.

---

## 6. Execution plan

**Standing rules applied:**
- Branch → `qa` only.
- Each migration runs as one transaction (`begin; set local search_path to qa; …; commit;`, then the same file with `prod`).
- Rehearsals are rolled back: `begin isolation level repeatable read`, slow fingerprints **before** any DDL, `set local lock_timeout = '3s'`, and the window after the first DDL kept well under a second (or you're warned first; QA has live testers).
- No storage is touched.
- **No prod change on a Friday** (SAY's service day).
- Hand-over SQL starts with `set search_path to qa;` so you can swap to `prod`.

| Phase | What happens | Gate |
|---|---|---|
| **G0. Plan review** | 🔄 Q3–Q9 answered (v1.2). 🆕 Q10, Q11 and the Read-Only assumption answered (v1.3). 🆕 Q12 answered. **All design questions are answered**; only your confirmation of O1/O2 remains, any time before Q5. | **G0**: you approve the design |
| **Q0. QA prep** | Remove QA SAY's stray servant grant on "2009 - Yr 0" (test data, with your OK). The migration also refuses to run if any grant sits on a group becoming hidden. | – |
| **Q1. Build** | 0069 + down, 0070 + down, test scripts (§7), app changes; code review | **G1**: you approve the SQL and change list |
| **Q2. QA rehearsal** | 0069 + the full V1–V5 suite in a rolled-back transaction on QA | **G2**: you see the results |
| **Q3. QA apply** | 0069 committed on QA; code merged to `qa` right after. Because the new terminals are empty, nothing changes for SAY testers except the new panels. | – |
| **Q4. TST ladder tests** | You (or I, by impersonation first) run the TST scenarios (V7) on the QA TST address | – |
| **Q5. QA split** | With O1/O2 answered: 0070 rehearsed (rolled back) on QA, then committed; V9 checks | **G3**: you sign off QA |
| **Q6. Acceptance** | Testers check SAY on QA (side-menu switcher and where `/` lands them, hidden groups per role, QR page and print, check-in on the terminal QR on a QA service day) | **G4**: you decide it's ready |
| **P0. Prod pre-flight** | Read-only: prod structure = QA's before 0069; counts re-taken; you take a fresh `pg_dump` | – |
| **P1. Prod rehearsal** | 0069 then 0070 in one rolled-back transaction on prod, off-Friday, lock window measured | **Explicit go-ahead** |
| **P2. Prod apply** | 0069 → code to `main` → 0070, same evening (not Friday); post-checks V1–V9 | – |
| **P3. Posters** | 🔄 Nothing needs reprinting (shared code, §5.5). Optionally reprint the "2004 & older" sheet with its new name "2004 - Yr 5"; add any extra servants to "2003 - Yr 6" | – |

Docs updated with the code: REQUIREMENTS §2.2, §4.3, §5, §6.9, §6.10, §6.15 and DATABASE_SCHEMA §2, §15 and M.

---

## 7. Verification plan

| # | Check | Pass criterion |
|---|---|---|
| **V1** | **Catalog:** `kind` not null; one active pre-entry and 🔄 at least one terminal per ministry; levels 1…N contiguous; display order pre-entry first / terminal last; every rule above contains the hidden-group condition; new functions have a pinned `search_path` and no anonymous access; 🔄 the check-in functions still start from the token and stay within one ministry | zero violations |
| **V2** | **Data:** youth, attendance, outreach, grant and QR counts unchanged by 0069; every group's name, colour and QR token unchanged except the new terminals | exact match |
| **V3** | **SAY fingerprint by role** (every QA user with a role, impersonated): rows visible per table before vs after 0069 | **identical** (hidden groups are empty at that point) |
| **V4** | **Hidden-group matrix** (rolled-back test with synthetic youths in pre-entry and terminal): GC, Coordinator, servant, Read-Only can't read, add, change, move into/out of, delete, export, photo, attend, or outreach hidden youths; Admin and Church Admin can; grants on hidden groups are refused | 100% pass |
| **V5** | **Ministry isolation** (Project B's V4 re-run): SAY and TST can't touch each other's groups through any new function (`add_group`, `move_group`, `set_group_level`, `archive_terminal_members`, preview, transition) | 100% pass |
| **V6** | Supabase security and performance advisors; timing of the GC youth list and attendance history | no new warnings; no slower than today |
| **V7** | **TST ladder test (QA):** add "Grade 4" → last before the terminal, level 4 (the original bug); move groups up/down → the side-menu switcher follows; add a second class at Grade 2 → both level 2; change level fixes the swapped Grade 2/3; first level 9 → shows "Grade 9…"; transition with a youth in the terminal → blocked, lists them, Archive clears it; transition → both top classes enter the terminal, renamed from the pattern, grants rolled back, assignments cleared, pre-entry becomes Grade 1 with a check-in QR, new pre-entry intake-only with the relayed colour; preview = result | all as described |
| **V8** | **Check-in:** on a QA service day the terminal QR lists its youths and records attendance; pre-entry QR is intake-only; archived youths are not listed; the Servants QR is unchanged. 🔄 **Switches:** a switched-off code answers "isn't active" and is missing from the QR page for every role, Admin included. 🔄 **Shared code:** lists the youths of every sharing group (not those of a switched-off one); records attendance for a Yr 6 and a hand-over youth; 🆕 new sign-ups born 2004, 2003, 2001, 2006, with no date and with 2025 land in Yr 5, Yr 6, hand-over, Yr 5, Yr 6 and Yr 6 (Q11); "Is this you?" never moves someone between sharing groups; a code from another ministry can't be shared | all ticked |
| **V9** | **Split checks** (§5.2 step 8), plus role-by-role: Kristeen/Mike see what O2 says; a GC doesn't see the 63; an Admin does | exact match |
| **V10** | App smoke: Group Names panel, Group Transition preview/block/archive (TST), side-menu switcher and default cohort per role, QR page and print per switch, Export Lists, All-cohorts views, Servant Assignments pickers | all ticked |
| 🔄 **V11** | **Coordinator's combined view (TST):** a Coordinator on 2 classes gets the combined entry named from the shared words, lands on it, and sees only those 2 classes' youths; with 1 class, no combined entry (SAY unchanged); a servant or Read-Only never gets one; after a transition it follows the classes. 🆕 SAY (QA, after the split): Kristeen and Mike see "Yr 5 + Yr 6" with exactly the youths of both groups, and keep their assignments. 🆕 Q12: a TST transition where one person coordinates both the graduating class and one that stays → their graduating grants are dropped, not moved to level 1 | all ticked |
| 🔄 **V12** | **D12 hand-over modes (TST, rolled back):** two top classes with mixed genders → "one", "per gender" and "separate" each give the previewed groups and counts; a youth with no gender is listed, not lost; the next transition is blocked until every hand-over group is empty | all ticked |

---

## 8. Rollback plan

| If a problem is found… | Rollback |
|---|---|
| During a rehearsal | Nothing to do (rolled back) |
| While 0069 or 0070 runs | Automatic: one transaction, self-checks undo it |
| After 0069, before the split | `0069_down`: restores the 0064/0067 functions and rules, drops the new columns and the (empty) terminals. It refuses if a real transition already ran under the new model. |
| After the code deploy | Vercel instant rollback. The old code still works on 0069 (terminal = highest number). |
| After the split | `0070_down` restores every youth's group and assignment and the grants from the backup table, and archives "2003 - Yr 6". Attendance and outreach were never moved, so nothing else needs restoring. |
| Worst case | Your `pg_dump` taken at P0 |

---

## 9. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | A screen or function still treats "highest number" as terminal | Medium | Medium | §2.3 inventory; terminal stored as N+1 so old logic stays roughly right; V7/V10 |
| R2 | GCs lose sight of people they relied on (the 63; Yr 0 intake) | Medium | Low | Intended; announce it; Admins keep full access |
| R3 | **Old "2004 & older" poster mis-files people after the split** | 🔄 Removed | – | 🔄 The shared code (D13) keeps the old poster valid for all three groups |
| 🔄 R12 | The shared code's list mixes Yr 5, Yr 6 and hand-over names | Certain | Low | Same people and same list size as "2004 & older" today |
| R4 | Transition fails on duplicate grants (same person, same role, two top classes) | Low (High School) | Medium | Duplicates dropped, not failed; tested in V7 |
| R5 | Transition blocked in September because the terminal still has people | Certain for SAY in 2027 (63 today) | Low | Archive / hand over during the year; the screen offers Archive + Export |
| R6 | Archived youths come back and re-register as duplicates | Low | Low | Later: "Archived people" list with Unarchive (§10) |
| R7 | Name clashes after dropping cohort-year uniqueness | Low | Low | Active-name uniqueness checked by every function |
| R8 | Rehearsal locks slow QA/prod pages | Medium | Medium | Rehearsal rules in §6; lock window measured; not on Friday |
| R9 | Q3 not applied → next transition renames SAY groups "…Cohort…" | High if skipped | Low | Q3; the preview now shows the exact names before you confirm |
| R10 | 🔎 The existing 22 carry-over assignments in prod Yr 3 keep showing wrong caseloads | Existing | Low | Q6; not auto-fixed |
| R11 | Children's photos of hidden youths are still in public buckets | Existing | Medium | P7 reminder: decide private buckets before any children's ministry launches |

---

## 10. Open items and later phases

### 10.1 Cross-ministry hand-over (later phase, not built now)
- **Likely scope:** move the person's profile plus the **last 12 months of attendance** (perhaps only the average attendance %) into the next ministry's pre-entry. Outreach is probably not moved and stays archived with the old record.
- **Blocker today:** the hard wall between ministries (composite keys and the rules from Project B) deliberately makes cross-ministry moves impossible. The feature needs its own design: who approves (both Admins?), what is copied vs moved, and the audit on both sides.
- **Until then:** Admin exports the terminal list (Export Lists), and the next ministry's Admin enters or imports it (import rules, REQUIREMENTS §10.3). Then Archive in the old ministry.

### 10.2 High School (HSY): what the model already allows, and what to learn
- **Already allowed:** 4 classes per grade at the same level; offset 8 🔄 with level word "Gr" (Gr9–Gr12); a per-class pattern like 🔄 `{label}{level} Boys St Anthony` → "Gr9 Boys St Anthony"; `sub_coordinator_auto_servant` off; manual attendance per class (the QR switches can hide unused codes); 🔄 the hand-over choice at graduation (D12); 🔄 each coordinator's combined view of their 2 classes as their default (D14, §4.6).
- **To learn from HSY:**
  1. How the new Grade 9 classes are formed from the incoming list. Does the one pre-entry split into 4, meaning the transition should *not* move pre-entry wholesale to Grade 9 (a per-ministry setting), plus a bulk "move to class" tool?
  2. When a class graduates, does its **servant** start a new Grade 9 class with the same saint name ("restart at level 1" mode instead of archiving the row)?
  3. **Coordinators (owner, 2026-09-30):** each grade has **two** coordinators: a male one overseeing that grade's 2 boys' classes and a female one overseeing its 2 girls' classes. With class = cohort, each is a Coordinator on exactly their 2 classes (the "All cohorts" view then shows just those 2). **Answered (30 Sep): coordinators move up with their classes**, so their grants follow the class rows automatically at each transition, as today; nothing new to build. The two coordination levels are General Coordinator and Coordinator (the database's `sub_coordinator`, shown as "Coordinator" in the app). 🔄 Side-menu D11 (land on the first listed class) is **replaced by D14**: a coordinator lands on the combined view of their 2 classes (§4.6). At graduation, Grade 12's coordinators, like its servants, go back to the new Grade 9; which of the 4 new classes they go to is item 2 above.
  4. Is QR used at all, or should both switches and class QRs be off?
- Nothing in this plan blocks any of these answers.

### 10.3 Sunday School: what to learn
- Classes per grade, and whether classes are **re-mixed** every year (if so, class ≠ cohort and the transition needs a "redistribute" step)
- Whether teachers stay with a grade
- Age range and pre-entry (nursery / registration?)
- Hand-over to Junior High
- Parent email as contact (open intake-email item)
- Manual vs QR attendance
- Photo privacy (P7)

### 10.4 Connect2
A future post-university ministry created in the console. It receives SAY's terminal people through the manual hand-over first. 🔄 **Q7 answered:** 2003 stays in SAY this year, so the first Connect2 list **excludes the 2003 cohort** (born 1996–2002 only). The 2003s reach hand-over at next September's transition ("2003 - Transitioning").

### 10.5 Small follow-ups (your call)
- A per-person **Archive** button on a hidden-group youth (Admins), and an **Archived people** list with **Unarchive**
- 🔄 **"Permanently delete people archived more than N years ago"** (Admins, with a count and a typed confirmation; removes their attendance, outreach and photos too). Not needed for space for many years (D6), but useful for privacy once children's ministries join.
- Clearing the 22 existing Yr 3 carry-over assignments (Q6: the rule is yes, these 22 are still your call)
- Tidying TST's test groups with the new controls
