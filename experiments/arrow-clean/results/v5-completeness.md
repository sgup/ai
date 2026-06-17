# Variant: v5-completeness

Approach only. No fix implemented; the repo was treated as read-only. All claims below are
marked **confirmed** (with the command/file:line that proves them) or **inferred**.

## P1 — Diagnose: reproduce the symptom and find the true root cause

### Step 1 — Reproduce the exact reported symptom, by the same path

Run `humanize()` in auto-granularity (the default the bug report uses), future direction,
anchored at Jan 9 2026, sweeping the day range the report names:

```
cd /tmp/arrow-clean/arrow && PYTHONPATH=/tmp/arrow-clean/arrow python3 -c "
import arrow
base = arrow.Arrow(2026, 1, 9)
for d in range(10, 22):
    print(d, '->', repr(base.shift(days=d).humanize(base)))
"
```

**Confirmed output** (ran it):
```
10..13 -> 'in a week'
14     -> 'in 2 weeks'
15     -> 'in a month'
16     -> 'in a month'
...
21     -> 'in a month'
```

So 15 and 16 days return `'in a month'` — the reported symptom, reproduced exactly, same
path (default `granularity="auto"`), not a cousin. **Confirmed.**

### Step 2 — Map the full extent, not just the two reported inputs

Sweep wider to learn the real shape of the defect (confirmed via a day-by-day sweep 7→70,
and an hour-resolution sweep 7d→35d):

- `'in 2 weeks'` is produced at **exactly 14 days and nowhere else** — at hour resolution
  the distinct future outputs between 7d and 35d are only `{'in a week', 'in 2 weeks', 'in a month'}`. **Confirmed.**
- Days **15 through ~45** all collapse to `'in a month'`; `'in 2 months'` first appears
  around day 46. **Confirmed.**
- The defect is symmetric in the past direction: `15d ago`…`28d ago` all return
  `'a month ago'`. **Confirmed.**

This already tells me the bug is **not** a wrong threshold constant for one input — it's that
the entire 15–27-day band (which a human calls "3 weeks" / "4 weeks") is swallowed by "a
month."

### Step 3 — Read the code and trace which branch fires

The logic is the `humanize()` method, `arrow/arrow.py:1133`, auto branch at lines
**1191–1262**. The decisive region:

- Lines **1217–1230** compute a calendar diff and a `calendar_months` count:
  ```
  calendar_diff = relativedelta(dt, self._datetime) if self._datetime < dt else relativedelta(self._datetime, dt)
  calendar_months = calendar_diff.years * 12 + calendar_diff.months
  # For months, if more than 2 weeks, count as a full month
  if calendar_diff.days > 14:        # line 1227
      calendar_months += 1
  calendar_months = min(calendar_months, 12)
  ```
- The branch ladder then runs in this order: day (1232), days (1235), **month/months
  (1239)**, week (1250), weeks (1253), …

The month branch at **line 1239** is `elif calendar_months >= 1 and diff < self._SECS_PER_YEAR`
and it `return`s. It sits **above** the week/weeks branches at **1250–1255**.

### Step 4 — Confirm the actual mechanism (instrument the intermediates)

Rather than guess, I printed the real intermediate values for the boundary inputs:

```
d=14: relativedelta(...,days=14)  days>14=False -> calendar_months=0  -> month branch NOT taken
d=15: relativedelta(...,days=15)  days>14=True  -> calendar_months=1  -> month branch TAKEN
d=16: relativedelta(...,days=16)  days>14=True  -> calendar_months=1  -> month branch TAKEN
```
**Confirmed.** So the true root cause is a **two-part interaction**, not a single bad number:

1. **The `> 14` rounding rule (line 1227) is far too aggressive.** A pure-day difference of
   15 has `relativedelta.days == 15 > 14`, so `calendar_months` is bumped from 0 to 1 even
   though zero calendar months have elapsed. The inline comment "if more than 2 weeks, count
   as a full month" *is the bug, stated as if it were intent* — 15 days is not a month. (At
   hour resolution the flip is exactly at the start of the 15th day: `14d23h -> 'in 2 weeks'`,
   `15d -> 'in a month'`. **Confirmed.**)

2. **Branch ordering makes the week/weeks branches unreachable.** Because the month branch
   (1239) precedes and `return`s before the week (1250) and weeks (1253) branches, once
   `calendar_months >= 1` the "3 weeks"/"4 weeks" outputs can never be produced in auto mode.
   The weeks branch at **1253–1255** (`weeks = delta_second // SECS_PER_WEEK`) is effectively
   **dead code under `granularity="auto"`** — confirmed by the 7d→35d hour sweep producing no
   "weeks" string other than the single "2 weeks" at exactly day 14.

### Step 5 — Confirm it's the *actual* cause, not a plausible-looking one

- **Falsification check:** if the cause were purely the `>14` rule, fixing only that would
  still leave 22–27 days mis-bucketed, because even with the rule corrected the month branch
  precedes the weeks branch. The wide sweep (15→45 all "a month") shows both factors are
  live, so naming only one would be an incomplete root cause. Ranking by evidence: the `>14`
  bump is what flips 15/16 specifically (confirmed by the instrumented `calendar_months`
  transition 0→1 at d=15); the ordering is what hides the corrected weeks output.
- **Not a constants bug:** `_SECS_PER_WEEK`, `_SECS_PER_MONTH` (= 30.5 days) etc. at
  `arrow/arrow.py:126–143` are sane; the month boundary the user expects (≈4 weeks) is
  defeated by the `relativedelta.days > 14` heuristic and branch order, not by `_SECS_PER_MONTH`.
- **Not locale-specific:** the calculation is in `arrow.py`; locales only format the chosen
  timeframe. Reproduced in default `en-us`.

## P2 — Fix design: where, how, and how to confirm correct AND complete

### Where

Single site: the auto branch of `humanize()`, `arrow/arrow.py`, lines **1217–1255**. Two
coordinated changes (design, not implemented):

1. **Fix the "round up to a month" rule (line 1227).** The `calendar_diff.days > 14` bump
   promotes 15+ pure-day diffs to a month. The 15–27-day band should be allowed to fall
   through to the week/weeks branches. The defensible rule is to bump to a month only when a
   real calendar-month boundary is crossed (`calendar_months >= 1` already captures that),
   and otherwise let the residual days be reported as weeks. (The exact replacement predicate
   is an implementation choice; the design constraint is: a pure-day diff of 15–27 must NOT
   become a month.)

2. **Reach the weeks branch (ordering / reachability of lines 1250–1255).** Ensure that when
   the diff is in the 15–27-day range the week (1250, "in a week"/"a week" — note this is
   actually the 8–13 day single-week wording slot) and weeks (1253–1255, "3 weeks"/"4 weeks")
   branches can execute instead of being pre-empted by the month branch at 1239. Today they
   are dead code in auto mode; the fix must make them live for that band.

I'd lead with this as the recommended shape and flag the alternative (only patch the `>14`
constant) as **rejected** because it leaves 22–27 days still mis-bucketed and leaves the
weeks branch dead — incomplete by the sweep evidence above.

### How to confirm correct AND complete (not just "the reported input works")

**Baseline first (captured, so "no regressions" means something):**
`PYTHONPATH=/tmp/arrow-clean/arrow python3 -m pytest tests/test_arrow.py -q`
→ **Confirmed baseline: 225 passed, 0 failed.** Critically, the suite is **fully green WITH
the bug present** — proof the 15–27-day band is untested. The existing
`TestArrowHumanize.test_weeks` (`tests/test_arrow.py:2208`) only checks `weeks=2` (= exactly
14 days, which already works), and `test_month` (line 2217) uses `shift(months=1)` (= 30
real days here, **confirmed**). So completeness requires **adding the missing cases**, not
just fixing day 15.

**The specific cases I'd assert after the fix (the full set a fix must satisfy):**

- **The two reported inputs:** Jan 9 2026 +15d and +16d → must be a "weeks" phrasing (e.g.
  "in 2 weeks"), not "in a month". (Currently both "in a month". **Confirmed pre-state.**)
- **Lower boundary that must NOT regress:** +14d → still "in 2 weeks" (currently correct —
  must stay correct). And the sub-day boundary `14d23h` currently "in 2 weeks" — must not
  flip to a month.
- **The whole band between, swept day-by-day 15→27** (and ±1 around each integer-week mark):
  each should read as 2/3/4 weeks, monotonic, with no jump back to "a week" and no premature
  "a month".
- **Upper boundary into months:** the first day that *should* read "in a month" (a true
  ~1-calendar-month diff, e.g. `shift(months=1)` = 30d, and ~28–31d) must still say "a month";
  +46d must still say "in 2 months". (Currently 30d → "a month", 46d → "2 months".
  **Confirmed pre-state — must not regress.**)
- **Symmetry (past direction):** the mirror of every case above with `-d` (currently
  "15d ago"…"28d ago" all wrongly "a month ago" — **confirmed**). Past and future must agree.
- **Calendar-boundary edge, not just elapsed-seconds:** because the code uses
  `relativedelta` (calendar months), test an anchor where +15 days *does* cross a
  month boundary (e.g. Jan 20 +15d → Feb 4) vs one that doesn't, to make sure the new rule is
  driven by real calendar months and isn't reintroducing the `days > 14` artifact.
- **Non-auto granularity untouched:** `granularity="week"` and `granularity="month"` paths
  (lines 1264–1293) and the existing assertions at `tests/test_arrow.py:1974–1993` (e.g.
  `granularity="week"` → "4 weeks ago", `granularity="month"` → "in a month") must be
  unchanged — the fix is scoped to the auto ladder only.
- **Locales:** spot-check a `locale_list_with_weeks` locale (the parametrized week tests at
  `tests/test_arrow.py:2701–2728`) for one band value, since only locales with a distinct
  "weeks" timeframe will now exercise the newly-reachable branch.

**Gate after the change:** re-run the *whole* file (`pytest tests/test_arrow.py -q`), read
the real exit code, and report the delta against the captured `225 passed`. A green suite is
necessary but **not sufficient** here — the pre-fix suite was already green with the bug — so
"complete" specifically means the added band/boundary/symmetry/locale cases above are present
and passing, AND the previously dead weeks branch (lines 1250–1255) is now exercised by at
least one test.

### The one claim I'd most expect to be wrong / to need a judgment call

The exact replacement predicate for line 1227 and the precise week/month cutover day (is +27
the last "weeks" day or +28?) is a product-judgment boundary, not a mechanical fact — it
should be pinned by an explicit chosen threshold and its own boundary test, and ideally
checked against upstream arrow's intended behavior before settling on the number. The root
cause and the set of cases above are confirmed; the single cutover integer is the part I'd
flag for an explicit decision.
