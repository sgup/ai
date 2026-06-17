# Variant: none

## Summary of the bug (confirmed, not hypothesized)

In `Arrow.humanize()` (`arrow/arrow.py`, method starts at line 1133), with `granularity="auto"` the entire span of **15 to 31 days in the future** collapses to `"in a month"`. The two "week" auto-branches (lines 1250-1255) are effectively dead for any day-offset of 15+ days. Reproduced exactly against the reported scenario.

---

## P1 — Diagnose: reproduce and find the TRUE root cause

### Step 1 — Reproduce the exact symptom

```
cd /tmp/arrow-clean/arrow && PYTHONPATH=. python3 -c "
import arrow
now = arrow.Arrow(2026,1,9)
for d in [13,14,15,16,17,20,24,25,26,30,31]:
    print(d, '->', repr(now.shift(days=d).humanize(now)))
"
```

Observed output:

```
13 -> 'in a week'
14 -> 'in 2 weeks'
15 -> 'in a month'
16 -> 'in a month'
17 -> 'in a month'
20 -> 'in a month'
24 -> 'in a month'
25 -> 'in a month'
26 -> 'in a month'
30 -> 'in a month'
31 -> 'in a month'
```

So the user's report is precise: 15 and 16 days say `"in a month"`. A scan of the full range `range(8,32)` shows the actual mapping:

```
'in a week'  -> days 8..13
'in 2 weeks' -> day 14 only
'in a month' -> days 15..31   <-- the bug; everything from 15d up to ~a month is "a month"
```

The only positive day-offset that ever produces a plural-weeks answer is exactly 14 days. That single survivor is the clue.

### Step 2 — Read the relevant code (the `granularity == "auto"` block, lines 1191-1262)

The decisive lines:

- Line 1186: `_delta = int(round((self._datetime - dt).total_seconds()))`; line 1188: `delta_second = diff = abs(_delta)`.
- Lines 1217-1230 — a calendar-based month count is computed *unconditionally* before the day/week/month branches:
  ```
  calendar_diff = relativedelta(...)                 # 1217-1221
  calendar_months = years*12 + months                # 1222-1224
  if calendar_diff.days > 14:                         # 1226-1227  <-- the bump
      calendar_months += 1                           # 1228
  calendar_months = min(calendar_months, 12)         # 1230
  ```
- The decision chain is an `if/elif` ladder (1232-1262) evaluated **in this order**:
  1. `diff < SECS_PER_DAY*2` -> "day"            (1232)
  2. `elif diff < SECS_PER_WEEK` -> "days"        (1235)
  3. `elif calendar_months >= 1 and diff < SECS_PER_YEAR` -> "month"/"months"  (1239) **<-- intercepts here**
  4. `elif diff < SECS_PER_WEEK*2` -> "week"      (1250) — unreachable once (3) is true
  5. `elif diff < SECS_PER_MONTH` -> "weeks"      (1253) — unreachable once (3) is true

### Step 3 — Trace the actual branch taken (prove the cause, don't guess)

```
cd /tmp/arrow-clean/arrow && PYTHONPATH=. python3 -c "
import arrow
from dateutil.relativedelta import relativedelta
A=arrow.Arrow; now=A(2026,1,9)
for d in [14,15,16,21,30]:
    later=now.shift(days=d); diff=d*A._SECS_PER_DAY
    cd=relativedelta(later._datetime, now._datetime)
    cm=cd.years*12+cd.months + (1 if cd.days>14 else 0)
    print(f'd={d}: reldelta.days={cd.days} bump={cd.days>14} calendar_months={cm} '
          f'month_branch_wins={cm>=1 and diff<A._SECS_PER_YEAR} -> {later.humanize(now)!r}')
"
```

Output:

```
d=14: reldelta.days=14 bump=False calendar_months=0 month_branch_wins=False -> 'in 2 weeks'
d=15: reldelta.days=15 bump=True  calendar_months=1 month_branch_wins=True  -> 'in a month'
d=16: reldelta.days=16 bump=True  calendar_months=1 month_branch_wins=True  -> 'in a month'
d=21: reldelta.days=21 bump=True  calendar_months=1 month_branch_wins=True  -> 'in a month'
d=30: reldelta.days=30 bump=True  calendar_months=1 month_branch_wins=True  -> 'in a month'
```

### Root cause (the real one, with the mechanism)

Two interacting facts, both required:

1. **The bump at line 1227** — `if calendar_diff.days > 14: calendar_months += 1` — fabricates `calendar_months = 1` for *any* offset whose calendar-day remainder exceeds 14 (i.e. 15+ days within the same month). At 15 days `relativedelta` gives `months=0, days=15`, and the bump turns that into 1 month. The comment on line 1226 ("if more than 2 weeks, count as a full month") is the author's intent, but 15-16 days is barely over 2 weeks, not a month.

2. **Branch ordering at line 1239** — the `calendar_months >= 1` month branch is placed *above* the two week branches (1250 "week", 1253 "weeks"). So once the bump sets `calendar_months = 1`, the month branch fires and the week branches at 1250/1253 are never evaluated for the 15-27 day range. The week branches are reachable only when `calendar_months == 0`, which (given the bump) happens only for `diff` in `[SECS_PER_WEEK, 15 days)` — and that sub-range is already consumed by the "days" branch (1235, `diff < SECS_PER_WEEK`) and the day=14 case. That is exactly why **day 14 is the lone survivor**: at 14 days `reldelta.days == 14`, the bump does NOT fire (`14 > 14` is False), `calendar_months == 0`, the month branch is skipped, and execution falls through to line 1253's "weeks" branch giving "2 weeks".

So the symptom is not a wrong constant in isolation; it is the **bump (1227) feeding a mis-ordered elif ladder (1239 before 1250/1253)**. Both are needed to produce the bug.

### How I confirmed this is the ACTUAL cause, not a plausible-looking one

- **Branch instrumentation** (Step 3): I computed `calendar_months` and the literal condition `calendar_months >= 1 and diff < SECS_PER_YEAR` and showed it is `True` for d=15..30 and `False` for d=14 — matching the observed outputs one-for-one.
- **The lone-survivor test**: the theory predicts day 14 is the *only* day producing weeks-plural, and that 13 produces "a week" (caught earlier by the `diff < SECS_PER_WEEK` days branch). The `range(8,32)` scan confirms precisely this partition. A wrong theory (e.g. "`_SECS_PER_MONTH=30.5` threshold is too small") would not explain why 21 days — which is well under 30.5-day seconds and under `SECS_PER_WEEK*2` is False but `SECS_PER_MONTH` is True — still says "month": it says month because branch (3) short-circuits before branch (5) is reached, which I verified directly.
- **Counterfactual check**: the `diff < SECS_PER_WEEK*2` (1250) and `diff < SECS_PER_MONTH` (1253) conditions are individually `True` for d=15 (week*2 is False at 15, month is True), yet they don't fire — proving the problem is *ordering/short-circuit*, not the week thresholds themselves.

---

## P2 — Fix design: where, how, and how to confirm correct + complete

### Where

A single, localized region inside `humanize()`'s `granularity=="auto"` block in `arrow/arrow.py`: the bump at **lines 1226-1228** and the relative ordering of the month branch (**1239**) versus the week branches (**1250, 1253**). No constants need changing; the constants (`_SECS_PER_WEEK`, `_SECS_PER_MONTH=30.5d`, etc.) are fine.

### How (design, not implemented)

The goal: a "in N weeks" band should exist between ~2 weeks and ~4 weeks, and "a month" should start only when the span is genuinely close to a month. Two complementary changes:

1. **Tighten / move the month-bump threshold.** The `days > 14` bump (1227) is what manufactures a spurious month at 15 days. It should either be removed in favor of letting the week branches handle 15-27 days, or raised so it only fires when the day remainder is close to a full month (e.g. `> 25`, near `30.5 - rounding`). Intent: 15-27 days should be describable as weeks, not a month.

2. **Reorder the elif ladder so the week branches are evaluated before the month branch** for spans below the month threshold — i.e. let `diff < SECS_PER_WEEK*2` ("week", 1250) and `diff < SECS_PER_MONTH` ("weeks", 1253) take precedence, and only fall to month when `diff >= SECS_PER_MONTH` (or when `calendar_months >= 2`, the genuine multi-month case). The `calendar_months` machinery is still needed for accurate month *counts* at larger spans (e.g. the year/min(...,12) handling), so it should be kept but gated so it cannot pre-empt the sub-month week band.

The exact target behavior to encode:

```
8..13 days  -> "a week"      (unchanged; from the days branch boundary)
14..20 days -> "2 weeks"     (currently only 14 works)
21..24 days -> "3 weeks"
25..27 days -> "4 weeks"     (or roll into "a month" near 30.5d, a design choice to pin down)
~28..45 days-> "a month"
```

This is a behavior decision; whichever exact cutoffs are chosen, the fix must (a) keep day 14 = "2 weeks", (b) give days 15-16 a weeks answer (the bug report), and (c) leave the genuine month/year cases untouched.

### How I would confirm the fix is correct AND complete (without regressing)

**A. Re-run the exact reproduction** and assert the new band is monotonic and contains a real "weeks" region:

```
PYTHONPATH=. python3 -c "
import arrow
now = arrow.Arrow(2026,1,9)
for d in range(8,46):
    print(d, now.shift(days=d).humanize(now))
"
```
Confirm 15 and 16 days no longer say "a month" and that "in 2/3 weeks" appears before "in a month".

**B. Run the existing suite — these are the specific cases that lock current behavior and must NOT regress:**

```
PYTHONPATH=. python3 -m pytest tests/test_arrow.py -q -k "humanize"
```
Named tests in `tests/test_arrow.py` (class `TestArrowHumanize`) to watch:
- `test_week` (line 2199): `weeks=1` -> "in a week" / "a week ago".
- `test_weeks` (line 2208): `weeks=2` (=14 days) -> "in 2 weeks". This is the fragile boundary case — the fix must keep 14d = "2 weeks".
- `test_month` (line 2217): `months=1` -> "in a month".
- `test_months` (line 2226): `months=2` -> "in 2 months".
- `test_days` (line 2180): `days=2,3,4` -> "in N days", incl. the issue-541 regression at `days=3, seconds=1` -> "in 3 days".
- `test_year` (2236) / `test_years` (2245): 1 and 2 years, and `arrow.Arrow(2014,7,2).humanize(self.datetime)` -> "in a year".
- The granularity-specific tests around lines 1974-1993 (`granularity="week"` / `"month"`): e.g. `later106.humanize(self.now, granularity="week") == "in 4 weeks"` and `granularity="month" == "in a month"`. These exercise the *non-auto* branch (lines 1264-1293), which the fix must leave entirely alone — a good guardrail that I only touched the `auto` path.
- `test_week_limit` (line 2297, issue #848) and the multi-granularity-list test that expects `"37 months and 4 weeks"` (around line 2091) — verify the `calendar_months`/min(...,12) logic still produces correct large-span counts.

**C. Boundary/edge cases I would add and verify explicitly (these are where reordering bugs hide):**
- **Exactly 14 days** (the lone survivor) stays "2 weeks" — the single most likely regression.
- **13 days** stays "a week" (must not leak into the new weeks band from the wrong side).
- **The negative/`ago` direction**: every case mirrored, e.g. `now.shift(days=-16).humanize()` and `now.humanize(now.shift(days=16))` — `sign` handling (line 1187) means past and future must stay symmetric.
- **Cross-month-boundary inputs**, since the bug is driven by `relativedelta` day-remainder, not raw seconds. Test 16 days starting near end of month, e.g. `arrow.Arrow(2026,1,20).shift(days=16)` and `arrow.Arrow(2026,2,25).shift(days=16)`, to ensure the calendar-vs-seconds interaction gives the same weeks answer regardless of start date.
- **Just under and just over the month threshold**: ~27, 28, 30, 31, 45 days — confirm a clean monotonic transition weeks -> "a month" -> "in N months" with no gap or double-jump.
- **~11-13 months / year boundary**: confirm `min(calendar_months, 12)` and the "in a year" transition (around 360-380 days) are unaffected.

**D. Completeness check** — the fix is complete only if the dead week branches (1250, 1253) become reachable for a real input range. I would verify by instrumenting (temporarily, in a throwaway script, not the source) which branch each day-offset hits across `range(8,400)` and confirming every auto-branch from "days" through "years" is now reachable, and that the output sequence is monotonic non-decreasing in magnitude. That, plus a green `pytest -k humanize`, distinguishes a real fix from one that merely patches the two reported day values while leaving 17-27 days still wrong.
