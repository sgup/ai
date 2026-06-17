# Variant: none

Diagnosis and fix design for arrow `humanize()` reporting "a month" for ~15-16 day differences. **Approach only — no fix implemented, no files edited.** All findings below were verified by running code against the read-only clone at `/tmp/arrow-stress/arrow`.

---

## P1 — Diagnose: reproduce + find the true root cause

### Step 1. Reproduce deterministically (don't trust "today")

The user's report is date-anchored ("As of Jan 9 2026"), and the humanize tests use `arrow.Arrow.utcnow()`, so I reproduce with a *fixed* base date to make it deterministic:

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
base = arrow.Arrow(2026, 1, 9)
for d in [13,14,15,16,17,18,20,24,25,26]:
    print(d, '->', base.humanize(base.shift(days=d)))"
```

Observed output (symptom confirmed):

```
13 -> a week ago
14 -> 2 weeks ago
15 -> a month ago     <-- jumps straight from "2 weeks" to "a month"
16 -> a month ago
...
25 -> a month ago
```

(Sign/direction is irrelevant: `base.humanize(later)` says "a month ago", `later.humanize(base)` says "in a month"; same code path.)

### Step 2. Map every transition boundary (don't fixate on day 16)

To see the real shape of the bug rather than one anecdotal input, I enumerate transitions over a wide range:

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
base = arrow.Arrow(2026,1,9); prev=None
for d in range(1,400):
    s = base.humanize(base.shift(days=d))
    if s != prev: print(f'{d:3d}: {s}'); prev=s"
```

Result (transitions only):

```
  1: a day ago        7: a week ago      14: 2 weeks ago
 15: a month ago     46: 2 months ago   74: 3 months ago   ... 365: a year ago
```

**Key insight that this reveals:** the sequence goes `2 weeks` (day 14) → `a month` (day 15) with **no "3 weeks" step at all**, and *everything from day 15 to day 45 is labeled "a month."* The bug is not "16 days is mislabeled"; it is "the entire 15–45 day band collapses into 'a month,' and the '3 weeks / N weeks' band is never produced in auto mode."

### Step 3. Read the implementation and locate the mechanism

`humanize()` is at `arrow/arrow.py:1133`; the `granularity == "auto"` block is lines 1191–1262. The relevant region:

- **Lines 1217–1230** compute a calendar-based month count:
  ```
  calendar_diff = relativedelta(...)                       # 1217-1221
  calendar_months = years*12 + months                      # 1222-1224
  # For months, if more than 2 weeks, count as a full month
  if calendar_diff.days > 14:                               # 1227  <-- the "bump"
      calendar_months += 1                                 # 1228
  calendar_months = min(calendar_months, 12)               # 1230
  ```
- **Lines 1232–1262** are an `if/elif` chain checked **in this order**: day (1232) → days (1235) → **month/months `if calendar_months >= 1` (1239)** → week (1250) → weeks (1253) → year/years.

### Step 4. Confirm the actual cause (instrument the intermediate values)

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
from dateutil.relativedelta import relativedelta
import arrow
base = arrow.Arrow(2026,1,9)
for d in [14,15,16,25]:
    rd = relativedelta(base.shift(days=d)._datetime, base._datetime)
    cm = rd.years*12 + rd.months
    print(f'd={d}: rd.months={rd.months} rd.days={rd.days} bump(days>14)={rd.days>14} '
          f'calendar_months_base={cm} -> final={cm+(1 if rd.days>14 else 0)} | {base.humanize(base.shift(days=d))}')"
```

Output:

```
d=14: rd.months=0 rd.days=14 bump=False final=0 | 2 weeks ago
d=15: rd.months=0 rd.days=15 bump=True  final=1 | a month ago
d=16: rd.months=0 rd.days=16 bump=True  final=1 | a month ago
d=25: rd.months=0 rd.days=25 bump=True  final=1 | a month ago
```

This pins the true root cause to **two interacting facts**, not one:

1. **The bump at line 1227** (`if calendar_diff.days > 14: calendar_months += 1`) promotes any difference whose `relativedelta` day-component exceeds 14 into a full calendar month. For a pure 15-day gap, `relativedelta` yields `months=0, days=15`, so `calendar_months` becomes `0 + 1 = 1`.
2. **Branch ordering at line 1239:** the `elif calendar_months >= 1 ...` month branch is evaluated **before** the `week` (1250) and `weeks` (1253) branches. So the moment the bump makes `calendar_months == 1`, the month branch wins and the week branches are never reached.

### Step 5. Prove it's the real cause, not a plausible-looking one

I confirm the week branches are genuinely **dead code** in auto mode for this band (i.e. the bump+ordering is *sufficient* to explain the missing "3 weeks"), by searching for any base/offset that ever yields a "3 weeks"/"N weeks" string in auto granularity in the 15–30 day window:

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
found=False
for d in range(15,31):
    out = arrow.Arrow(2026,1,9).humanize(arrow.Arrow(2026,1,9).shift(days=d))
    if 'week' in out: found=True
print('any week-string in 15-30d band?', found)"
# -> any week-string in 15-30d band? False
```

Logical confirmation of unreachability: the `weeks` (plural) branch at 1253 requires `diff < SECS_PER_MONTH` AND that the month branch at 1239 did **not** fire, i.e. `calendar_months == 0`. But `calendar_months == 0` requires `relativedelta` `months == 0` **and** `days <= 14` (else the bump makes it 1), i.e. `diff <= 14 days`; meanwhile the weeks-plural branch only matters for `diff >= 14 days`. The two conditions only touch at the exact 14-day boundary, which the `week`/`weeks` floor never renders as "3 weeks." So the "weeks" branch is structurally unreachable — that is the smoking gun, and it rules out alternative explanations like "the SECS_PER_MONTH constant is wrong" or "relativedelta is miscomputing."

This is **not** a floating-point / constants bug. `_SECS_PER_MONTH = 30.5 days` (line 131) and `_SECS_PER_WEEK` (130) are fine; the week branches would produce correct strings if they were ever reached. The defect is purely the **bump heuristic + branch precedence**.

### Step 6. History check — confirms this is a known, regression-prone area

`git log -L 1226,1228:arrow/arrow.py` on the clone shows the most recent commit touching the bump line is:

```
2224255 Revert "Fix humanize reporting "a month" for 16-day differences (#1240) (#1242)" (#1264)
```

So **this exact bug was fixed once and then reverted.** That is a strong signal that a naive fix here previously broke other cases (most likely the `test_month` / `test_months` / `test_weeks` assertions, or month-end `relativedelta` day-overflow edges). The fix design below is therefore built around *not* re-triggering whatever regression caused #1264. (The clone is shallow/squashed and offline, so I could not retrieve the #1240 diff or #1264 body directly — `gh pr view 1240` fails with "Could not resolve" and no network. Treat the revert as a warning to verify month/week boundaries exhaustively, per P2.)

---

## P2 — Fix design: where, how, and how to confirm correct + complete without regression

### Where

All changes are inside the `granularity == "auto"` block of `humanize()` in `arrow/arrow.py`, specifically the bump (lines 1226–1230) and the branch ordering (lines 1232–1262). Locales and constants need no change.

### How (design, not implemented)

The cleanest correct behavior is to make the "weeks" band reachable and stop the bump from swallowing sub-month differences. Two coordinated changes:

1. **Order the week branches before the month branch** so that a difference under ~4 weeks is described in weeks. Concretely, the `week` (currently 1250) and `weeks` (currently 1253) branches should be evaluated *before* the `calendar_months >= 1` month branch (currently 1239), for the sub-month range. This makes day 15 → "2 weeks", day 21–22 → "3 weeks", etc.

2. **Tighten / remove the day-bump (line 1227).** The `if calendar_diff.days > 14: calendar_months += 1` rule is what manufactures a phantom month from a 15-day gap. Once weeks are handled first, this bump should only apply *near* a month boundary (e.g. when the time is already close to a full month, to round 28–30 day gaps up to "a month"), not for any `days > 14`. A defensible threshold is to only bump when the difference is within the final part of the month band (e.g. `days >= ~24`/closer to 30.5), so 15–23 days read as weeks and ~24–45 days read as "a month".

The exact numeric thresholds are a product decision; the structural requirement is: **weeks branch must be reachable for the 15–~27 day band, and the month branch must not fire for sub-month differences.** I would deliberately keep the change minimal and boundary-driven to avoid re-introducing whatever #1264 reverted.

### How to confirm the fix is correct AND complete without regressing — specific cases

**A. The reported symptom and its whole band (must change):** re-run the Step-2 transition map (`base = Arrow(2026,1,9)`, days 1–400). Acceptance: the sequence becomes monotonic and includes a weeks band, e.g.
`14: 2 weeks → 15: 2 weeks → 21: 3 weeks → ~28: a month → 46: 2 months → ...`, with **no** jump from "2 weeks" directly to "a month" and **no** 30-day-wide plateau of "a month" starting at day 15. Check both directions (`base.humanize(later)` and `later.humanize(base)`).

**B. Existing pinned auto-granularity tests in `tests/test_arrow.py` (must still pass):**
- `test_day` (2159), `test_days` (2181): 1 day → "a day"; 2 days → "2 days". Unchanged (handled at 1232/1235, before any of my edits).
- `test_week` (2199): `shift(weeks=1)` → "a week". Verified input gives `relativedelta days=7`.
- `test_weeks` (2208): `shift(weeks=2)` → "2 weeks". **Critical boundary** — I verified `shift(weeks=2)` produces `relativedelta(months=0, days=14)`, i.e. exactly the bump's `> 14` boundary (currently False). Any new threshold must keep 14 days → "2 weeks", and the new "3 weeks" band must not start at or below 14 days.
- `test_month` (2217): `shift(months=1)` → "a month". I verified this yields `relativedelta(months=1, days=0)` for utcnow base — handled by `calendar_months` from the months component, independent of the bump. Must remain "a month".
- `test_months` (2226): `shift(months=2)` / `-2` → "2 months". Same — driven by `relativedelta.months`, must be untouched.
- `test_year` / `test_years` (2236+): unchanged.
- `test_granularity` (1944), `test_multiple_granularity`, `test_week_limit` (2297): these use **explicit** granularity (`granularity="week"/"month"/...`), which goes through the *other* code path (lines 1264–1293), not the auto block I'm editing. They must be re-run to prove I didn't accidentally touch the explicit path; they should be unaffected.

**C. Boundary / edge cases the prior revert (#1264) implies I must cover:**
- **Exact boundaries:** days 13, 14, 15 (week↔weeks↔first-month transition) and the new weeks→month transition (around 27–30 days). Assert each side of every boundary in both directions.
- **Month-end `relativedelta` day-overflow:** base `Arrow(2026,1,31).shift(months=1)`. I verified this gives `relativedelta days=0` (→ "a month") because relativedelta normalizes month-ends, so it's safe — but it must be re-checked after the fix, since it's exactly the kind of edge that a threshold change can disturb. Also check `Jan 31 + 28/29/30 days` and Feb-length months.
- **Leap-year February** (`Arrow(2024,2,1)` band 14–31 days) to ensure the weeks/month transition is stable across 28/29-day months.
- **`only_distance=True`** variants (asserted in `test_week`/`test_month`) to ensure the "in"/"ago" wrapper is unaffected.

**D. Run the full suite, not just humanize:** execute `python -m pytest tests/test_arrow.py` (note: pytest is **not** installed in the provided env — `No module named pytest` — so a verifier must `pip install pytest` first, or run the assertions inline). Also run the locale humanize tests (`TestArrowHumanizeTestsWithLocale`, 2345+) and `dehumanize` round-trip tests (2701+, which call `humanize` then parse it back) — a changed string band could break `dehumanize` round-tripping if any locale lacks a "weeks" form.

**E. Completeness check (the part the naive fix missed):** explicitly assert that "3 weeks" is now *reachable* in auto mode (e.g. day ~21 from a fixed base), since the core defect was an unreachable branch — not merely that day 16 changed. A fix that only special-cases "16 days" would leave days 17–23 still wrong and would be incomplete.

### One-line root-cause summary

In `humanize()` (`arrow/arrow.py`), the `if calendar_diff.days > 14: calendar_months += 1` bump (line 1227) promotes any 15+ day difference to a full month, and because the `calendar_months >= 1` month branch (line 1239) is ordered **before** the `week`/`weeks` branches (lines 1250/1253), the entire 15–45 day band renders as "a month" and the "3 weeks"/"N weeks" band is dead code. Fix = reorder weeks-before-month and restrict the day-bump to near-month differences; verify against the boundary cases in B–E above, mindful that an earlier fix to this exact bug (PR #1240) was reverted (PR #1264).
