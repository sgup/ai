# Variant: v5-comprehensive

APPROACH ONLY. No fix implemented; no files in the arrow repo edited. The only file I created is this one. All "confirmed" claims below name the command/file:line that backs them; everything I did not execute is marked "inferred."

## TL;DR (the root cause, confirmed)

The symptom is real and **not** date-specific — the "Jan 9 2026" framing in the report is a red herring. In `humanize(..., granularity="auto")` in `/tmp/arrow-stress/arrow/arrow/arrow.py`, **every** future (or past) span from **15 days up to a full calendar month renders as "a month"**, and the `"3 weeks"`/`"4 weeks"` outputs are unreachable in auto mode. Two interacting defects, both in the `auto` block (lines 1217-1262):

1. **A coarse month bump (lines 1226-1228):** `if calendar_diff.days > 14: calendar_months += 1`. `calendar_diff` is a `dateutil.relativedelta`, so `.days` is the **day-of-month remainder**, not total days. For a 15-day span this turns `calendar_months` from `0` into `1`.
2. **Branch ordering (line 1239):** the `elif calendar_months >= 1 and diff < self._SECS_PER_YEAR:` month branch is tested **before** the `week` branch (line 1250) and the `weeks` branch (line 1253). So once defect (1) sets `calendar_months = 1`, anything ≥15 days short-circuits into "month" and the two week branches below it are dead for the 15-to-~31-day range.

The same `>14`-on-the-remainder logic also mis-rounds the month/month+1 boundary: 46 days ("1 month 15 days") → "in 2 months" while 45 days → "in a month" (confirmed below).

---

## P1 — Diagnose: reproduce, then find the true root cause

### Step 1 — Reproduce the exact reported symptom, by the same path the user hits

The user calls `humanize()` on a future event. Reproduced with the import path the task specifies:

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
base = arrow.Arrow(2026, 1, 9, 12, 0, 0)
for d in [14,15,16,18,21,24]:
    print(d, '->', base.shift(days=d).humanize(base))"
```
Confirmed output (ran it):
```
14 -> in 2 weeks
15 -> in a month
16 -> in a month
18 -> in a month
21 -> in a month
24 -> in a month
```
So 16 days → "in a month", matching the report verbatim. `"in 2 weeks"` only ever appears at **exactly** 14 days.

### Step 2 — Kill the plausible-but-wrong cause (the date) before trusting it

The report blames "as of Jan 9 2026," which invites a date/month-boundary theory. I tested that theory directly instead of assuming it:

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
for start in [(2026,1,9),(2026,2,15),(2026,3,1),(2026,6,17),(2026,2,1)]:
    b = arrow.Arrow(*start, 12, 0, 0)
    print(start, {d: b.shift(days=d).humanize(b) for d in [15,16,18,21]})"
```
Confirmed: identical `'in a month'` for 15/16/18/21 days from **every** start date. **The date is irrelevant** — so any "month-boundary"/"end-of-month" hypothesis is rejected by evidence, not by hand-waving. This is the kind of plausible-looking cause the prompt warns against; I disproved it rather than shipping it.

### Step 3 — Locate the deciding code and instrument the actual branch taken

Read `humanize`: `grep -n "def humanize" arrow/arrow.py` → line **1133**; the `auto` logic is lines **1191-1262**. The relevant constants are class attributes (`grep -n "_SECS_PER" arrow/arrow.py`, lines **126-133**): `_SECS_PER_WEEK = 604800`, `_SECS_PER_MONTH = 86400*30.5`, `_SECS_PER_YEAR`. (They are **not** in `constants.py` — I checked; the report's "thresholds seem off" instinct points here but the thresholds themselves are fine; the **ordering + the bump** are the fault.)

I replicated the in-function computation to see which `elif` fires (confirmed, ran it):
```
14d: relativedelta.days=14  bump(>14)=False  calendar_months=0  -> week/weeks branch region
15d: relativedelta.days=15  bump(>14)=True   calendar_months=1  -> MONTH branch (line 1239)
16d: relativedelta.days=16  bump(>14)=True   calendar_months=1  -> MONTH branch (line 1239)
21d: relativedelta.days=21  bump(>14)=True   calendar_months=1  -> MONTH branch (line 1239)
```
This is the smoking gun: at 15 days the `>14` bump (line 1227) flips `calendar_months` 0→1, and the month branch at line 1239 — placed **above** the week branches at 1250/1253 — claims the case.

### Step 4 — Confirm it is THE cause, not a coincidence

- **Full sweep** `for d in range(14,41)` from `Arrow(2013,1,1)` (confirmed): 14 → "in 2 weeks"; **15 through 40 all → "in a month"**. The `weeks` branch (line 1253, which would say "3 weeks"/"4 weeks") never fires for any day count — it is provably dead code in `auto` mode whenever the day-of-month remainder > 14.
- **Symmetry** (confirmed): `-15/-16/-21` days → "a month ago" — same defect for the past direction, so a fix must cover both signs.
- **Mechanism of the bump** (confirmed): because `calendar_diff.days` is the relativedelta remainder, 46 days ("1 month 15 days") → "in 2 months" but 45 days ("1 month 14 days") → "in a month". Same `>14` rule, same distortion one tier up — corroborating that the bump rule (not the thresholds) is the actual defect generator.
- **Why this shipped untested:** `tests/test_arrow.py::TestArrowHumanize::test_weeks` (line 2208) uses `shift(weeks=2)` = **exactly 14 days**, the one multi-week value still reachable. `test_month` (line 2217) uses `shift(months=1)` (a real calendar month). **No test exercises 15-27 days**, which is precisely the broken band — confirmed by reading those tests.

**Confidence this is the actual root cause:** high. It's confirmed three ways — instrumented branch selection, exhaustive day sweep showing the dead branches, and the bump's arithmetic reproduced in isolation — not from a single sample or from a function's name.

---

## P2 — Fix design: where, how, and how to prove it correct AND complete

`git blame` (confirmed) attributes lines 1226-1255 to a single commit `2224255` — the bump and the ordering were introduced together, so they should be reasoned about together.

### Where
All within the `auto` block of `humanize`, `arrow/arrow.py` lines 1217-1262. Two seams:
- **Ordering (line 1239 vs 1250/1253):** the month branch must not pre-empt the week branches for sub-month spans. The intent is clearly a tier ladder day → days → week → weeks → month → months; the month tier is simply mis-positioned above the week tiers.
- **The bump (lines 1226-1228):** `calendar_diff.days > 14` is the wrong predicate for "is this at least a month." A 15-day span is not a month. The boundary "promote to month" should be driven by an actual ≥1-month calendar difference (`calendar_months >= 1` from the `relativedelta` years/months alone), with the sub-month remainder routed to the week tiers — not by a day-remainder threshold.

### How (design, not implemented)
The correct shape: reach the week branches (`week` at ~7-13 days → "a week"/"in a week" already works at exactly 7-13; `weeks` for 14-27 days → "2/3/4 weeks") whenever the true calendar-month component is 0, and only enter the month branch when `relativedelta` actually yields ≥1 month. Concretely that means either (a) reorder so the `week`/`weeks` branches are tested before the month branch and gate the month branch on the un-bumped `calendar_months`, or (b) drop the `>14` day-remainder bump and let `_SECS_PER_MONTH`-based week-vs-month thresholds plus `calendar_months` decide. I am **not** choosing the exact edit here (APPROACH ONLY) — both must be validated against the full case matrix below before picking one, because reordering alone without addressing the bump can still mis-handle the 28-30 day seam where `calendar_months` is 1 but `diff < _SECS_PER_MONTH`.

### How to confirm the fix is correct AND complete without regressing

**Baseline first (captured, so "no regression" means something):**
- `cd /tmp/arrow-stress/arrow && PYTHONPATH=. <mise-py>/pytest tests/test_arrow.py -k Humanize -q -p no:cacheprovider -o addopts=""` → **50 passed, 0 failed** (confirmed).
- Full module: same command without `-k` → **225 passed, 0 failed** (confirmed).
- **Environment caveat (honest blocker, not worked around):** the repo's `tox.ini` `addopts` force `--cov` via `pytest-cov`, which is **not installed** on the only interpreter here that has the test deps (`pytz`, `simplejson`) — `pytest_cov: MISSING`. I ran the suite with `-o addopts=""` to strip the coverage gate. That means I have **not** verified the project's `--cov-fail-under=99` coverage gate; a real fix PR must add tests for the 15-27 day band to keep coverage green, and that gate should be run in an env with `pytest-cov` installed. I did not install anything or edit config.

**A fix is CORRECT when (new assertions a fix must satisfy — currently failing, by design):**
- 15-16 days → "in 2 weeks" / "2 weeks ago" (the reported case). Currently "a month" — confirmed failing.
- 7 days → "a week"; 14 → "2 weeks"; 21 → "3 weeks"; ~26-27 → "3 weeks" or "4 weeks" per the `_SECS_PER_MONTH` (30.5-day) threshold. The `weeks` branch (line 1253) must become reachable.
- Both signs: assert the `"... ago"` mirror for each (the defect is symmetric — confirmed).

**A fix is COMPLETE / non-regressing when these specific cases still hold (the seams most likely to break):**
1. **Existing green tests unchanged:** `test_week` (7 days → "a week"), `test_weeks` (14 days → "2 weeks"), `test_month` (`months=1` → "a month"), `test_months` (`months=2` → "2 months"), `test_days` incl. issue-541 regressions (3-4 days), and the granularity tests at lines 1974-1994 (`granularity="week"`/`"month"` explicit paths — these go through the **other** branch at lines 1264-1292 and must be untouched). Re-run `-k Humanize` and require **50 passed**, then diff names of any failure.
2. **The 28-31 day seam:** a ~29-30 day span (just under `_SECS_PER_MONTH`=30.5d but `relativedelta` may already show months=1) must land on a deliberate, asserted value (either "4 weeks" or "a month") and not flip-flop. This is the boundary most at risk from reordering.
3. **The month/month+1 seam:** 45 days vs 46 days. Today 45→"a month", 46→"in 2 months" (confirmed). After the fix this boundary must be intentional and asserted — don't fix the week tier while silently leaving this off-by-15-days rounding (it's the *same* `>14` bug one tier up; naming it is in scope even if fixing it is a follow-up).
4. **Tier neighbors untouched:** sub-week (1-6 days → "days"), and ≥1 year (`_SECS_PER_YEAR`, lines 1257-1262 → "year"/"years"). Sweep `range(1, 800)` days before/after and diff the two output maps — every change must fall **only** in the 15-to-~31-day band (and its negative mirror); any change outside it is a regression.
5. **Date-independence preserved:** re-run the Step-2 multi-start-date matrix; outputs must remain identical across start dates (the fix must not introduce a month-boundary dependency that wasn't there).
6. **Full module gate:** re-run all of `tests/test_arrow.py`, require **225 passed** (baseline), and read the real exit code — not a grep narrowed to humanize.

**How I'd confirm I fixed the real thing, not a look-alike:** re-instrument the branch taken for 15/16/21 days (the Step-3 harness) and confirm they now resolve through the `week`/`weeks` branches rather than the month branch — i.e. verify the mechanism changed, not just the string. Then re-run the exhaustive day sweep and diff against the pre-fix map to prove the change is confined to the broken band.

### The one claim I'd most expect to be wrong
The exact upper edge of the week band (does ~26-30 days read as "4 weeks" or "a month"?) depends on the `_SECS_PER_MONTH = 30.5d` threshold interacting with `relativedelta.months`, and is the seam a fix is most likely to get subtly wrong. That boundary value should be pinned by an explicit, intentional test assertion rather than left to fall out of the implementation.

### Out of scope / not done (honest status)
- No code edited; no fix written (APPROACH ONLY, as instructed).
- Did not run the `--cov-fail-under=99` coverage gate — `pytest-cov` is not installed in the deps-bearing interpreter (env blocker, reported above, not bypassed).
- Other locales: I verified the `en-us` default only. Other locales share this same `auto` code path (the bug is in `arrow.py`, not the locale), so they are inferred to be affected identically — not separately confirmed.
