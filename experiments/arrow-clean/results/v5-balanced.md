# Variant: v5-balanced

Approach only — no fix implemented, no files in the arrow checkout edited. Blast read: low-blast, fully reversible (read-only investigation of a deterministic pure function). Base checkout is a non-git read-only export at `/tmp/arrow-clean/arrow`; the real source file is **nested** at `/tmp/arrow-clean/arrow/arrow/arrow.py` (not `arrow/arrow.py`). Test baseline captured up front: **225 passed, 0 failed** (`PYTHONPATH=/tmp/arrow-clean/arrow python3 -m pytest tests/test_arrow.py -q`).

All claims below are **confirmed** by reading the cited lines and running the cited commands, unless explicitly marked inferred.

---

## P1 — Diagnose: reproduce + find the true root cause

### Step 1 — Reproduce the reported symptom by the reported path (confirmed)
The bug says: as of Jan 9 2026, ~15–16 days out reads "in a month". Run the auto-granularity path exactly as a caller hits it (no `granularity=` argument, which selects the `"auto"` branch):

```
cd /tmp/arrow-clean/arrow && PYTHONPATH=/tmp/arrow-clean/arrow python3 -c "
import arrow
base = arrow.Arrow(2026, 1, 9)
for d in [13,14,15,16,17,20,21,28]:
    print(d, 'days ->', base.shift(days=+d).humanize(base))"
```

Output (confirmed):
```
13 days -> in a week
14 days -> in 2 weeks
15 days -> in a month
16 days -> in a month   ...  21 -> in a month  28 -> in a month
```

The symptom is real and reproduces by the reported path. The discontinuity is precisely **at day 15**: day 14 = "in 2 weeks", day 15 = "in a month". 16 days is the user's example but the true edge is 15.

### Step 2 — Read the code that decides the bucket
The auto path is `Arrow.humanize`, the `if granularity == "auto":` block at **`/tmp/arrow-clean/arrow/arrow/arrow.py:1191`–1262**. The relevant region:

- 1217–1224: builds `calendar_diff = relativedelta(...)` and `calendar_months = years*12 + months`.
- **1226–1228**: `# For months, if more than 2 weeks, count as a full month` → `if calendar_diff.days > 14: calendar_months += 1`.
- **1239–1248**: `elif calendar_months >= 1 and diff < self._SECS_PER_YEAR:` → returns `"month"` / `"months"`.
- **1250–1251**: `elif diff < self._SECS_PER_WEEK * 2:` → `"week"`.
- **1253–1255**: `elif diff < self._SECS_PER_MONTH:` → `"weeks"` (plural).

The branch **order** is the crux: the `calendar_months >= 1` check at 1239 sits **before** the week/weeks checks at 1250 and 1253. So once `calendar_months` reaches 1, control returns "month" and the week branches are never consulted.

### Step 3 — Confirm the exact mechanism, not a plausible-looking one (confirmed by instrumentation)
Re-derive the intermediate values the code computes, for 14 vs 15 days, using the same `relativedelta`:

```
PYTHONPATH=/tmp/arrow-clean/arrow python3 -c "
from dateutil.relativedelta import relativedelta; import arrow
base = arrow.Arrow(2026,1,9)
for d in [14,15,16]:
    cd = relativedelta(base.shift(days=+d)._datetime, base._datetime)
    cm = cd.years*12 + cd.months
    print(d,'days: relativedelta.days=',cd.days,'base calendar_months=',cm,'>14 bump=',cd.days>14)"
```

Confirmed output: 14 days → `relativedelta.days=14`, `calendar_months=0`, bump `False`; 15 days → `relativedelta.days=15`, `calendar_months=0`, bump **`True`** → `calendar_months` becomes **1**.

So the true root cause is a **two-part interaction**, both in the auto block:

1. **The `> 14` bump (line 1227).** A 15-day gap has `relativedelta` `months=0, days=15`. The line `if calendar_diff.days > 14: calendar_months += 1` promotes a sub-month, ~2-week gap to a full calendar month. The comment ("if more than 2 weeks, count as a full month") is the literal intent — but rounding a 15-day delta *up to a month* is the wrong granularity decision and is what produces "in a month".
2. **Branch ordering (line 1239 before 1250/1253).** Because the months branch is tested before the weeks branches, the bumped `calendar_months == 1` short-circuits and returns "month", so a 15–29-day delta can never reach the "weeks" branch.

### Step 4 — Confirm it's the *actual* cause and rule out alternatives
- **It's not a `_SECS_PER_MONTH` threshold problem.** `_SECS_PER_MONTH = 60*60*24*30.5` (arrow.py:131). One might guess the weeks/month boundary is set by that constant. It isn't, for the auto path — the `calendar_months` branch at 1239 fires first and never reaches the 30.5-day comparison at 1253. I confirmed this by mapping every output bucket across days 7–40 from the actual test anchor 2013-01-01:

```
'in a week'   <- days 7..13
'in 2 weeks'  <- day 14
'in a month'  <- days 15..40
```

The "2 weeks" bucket is **exactly one day wide** (day 14 only), and "in a month" swallows days 15–40. This is the smoking gun: it shows the **`weeks` plural branch (lines 1253–1255) is dead code in the auto path** — "in 3 weeks" / "in 4 weeks" are unreachable. That confirms the cause is the branch-ordering + bump interaction, not a mis-set seconds threshold.

- **Anchor-independence (rules out a calendar/short-month artifact).** I reproduced 14→"2 weeks", 15/16→"month" from five different anchors including a short month and month/year boundaries (2026-01-09, 2026-02-01, 2026-02-20, 2026-04-15, 2025-12-31) — identical every time. So the bug is not specific to Jan 9 2026; that date is incidental.
- **Symmetry (confirmed).** Past direction matches: −14d → "2 weeks ago", −15d/−16d → "a month ago". Any fix must treat both signs (the code already uses `sign`/`abs`, so a single code path covers both).
- **Lever confirmed:** at 14 days `calendar_diff.days = 14` (`>14` is False), at 15 days it is 15 (`>14` True) — the `> 14` comparison is the exact knob that flips behavior.

**Root-cause statement (confirmed):** In `Arrow.humanize` auto branch (`arrow/arrow.py:1217–1248`), a 15-to-~29-day delta is rounded up to one calendar month by `if calendar_diff.days > 14: calendar_months += 1` (line 1227), and because the `calendar_months >= 1` branch (line 1239) is ordered before the week branches (1250/1253), it returns "month" and the "N weeks" branch is never reached.

I should name the pre-existing flaw honestly rather than launder it: the `> 14` bump is not merely "off by a bit" — combined with branch order it makes the `weeks` plural branch **unreachable** in the auto path, which is a latent defect independent of the user's specific date. That is broken, not a "convention."

---

## P2 — Fix design: where, how, and how to confirm correct + complete without regressing

### Where
Single location: the auto branch of `Arrow.humanize`, `/tmp/arrow-clean/arrow/arrow/arrow.py`, the region **1226–1255**. No other file needs touching for behavior; locale strings ("week"/"weeks"/"month") already exist and are exercised by the non-auto granularity paths.

### How (design — recommended option first, alternatives named)
The fix must (a) stop 15–~28-day deltas from rounding up to "a month", and (b) make the genuinely-dead `weeks` branch reachable so 15–29 days reads as "N weeks".

**Recommended — reorder + retune the threshold so weeks owns the sub-month band:**
- Make the week branches (currently 1250–1255) take precedence over the calendar-month branch for deltas below a real month. Concretely: the "is this a month yet?" decision should require either `calendar_months >= 1` from a genuine calendar month rollover **without** the artificial `+1` bump, or `diff >= _SECS_PER_MONTH` (≈30.5 days), and the weeks branch should handle everything from 14 days up to that boundary.
- That means: (1) remove or raise the `calendar_diff.days > 14` bump at line 1227 (it is the line that manufactures the false month), and (2) ensure the weeks-plural branch (`diff < _SECS_PER_MONTH`) is checked before the month branch for sub-30.5-day deltas. With the bump gone, a 15-day delta has `calendar_months == 0`, the 1239 branch is skipped, and `diff < _SECS_PER_MONTH` (1,296,000 s < 2,635,200 s) routes it to "N weeks" → `15 // 604800-per-week` math gives "in 2 weeks". 21 days → "in 3 weeks", 28 days → "in 4 weeks".

**Alternative A (narrower, lower-blast):** keep the bump but raise its threshold from `> 14` to something like `>= 25` (round up to a month only in the last few days before a true month). This loses less of the existing month-rounding intent but still leaves the weeks branch reachable only in a narrow window and keeps the fragile branch order; I'd reject it because it papers over the dead-branch defect rather than fixing the ordering.

**Alternative B (status-quo-preserving):** do nothing to ordering, only tweak the constant. Rejected — leaves the `weeks` plural branch dead.

I'd lead with the Recommended option but flag that exact threshold/rounding choices (e.g. does 24–29 days read "in 4 weeks" or "in a month"?) are a **product/UX fork** the maintainers should rule on, because there is no single objectively-correct cutover between "weeks" and "a month". This is a genuinely underspecified fork (per the judgment rule), so the precise boundary is a decision to surface, not silently pick.

### How to confirm the fix is correct AND complete (without regressing)
Baseline is recorded: **225 passed**. After any change, re-run the **whole** gate and report the delta, reading the real exit code — not a grep narrowed to humanize:
```
cd /tmp/arrow-clean/arrow && PYTHONPATH=/tmp/arrow-clean/arrow python3 -m pytest tests/test_arrow.py -q
```

**Cases that MUST stay green (existing tests — regression guard).** These encode the contract the fix must not break (`tests/test_arrow.py`):
- `test_week` (line 2199): `shift(weeks=1)` (7 days) → "in a week" / "a week ago".
- `test_weeks` (line 2208): `shift(weeks=2)` = **exactly 14 days** → "in 2 weeks". This is the sharp one — the fix must keep 14 days as "2 weeks" while flipping 15 days from "month" to "2 weeks". Confirm both sides of the boundary explicitly.
- `test_month` (line 2217): `shift(months=1)` → "in a month". A true 1-calendar-month delta (28–31 days depending on anchor) must still say "a month".
- `test_months` (line 2226): `shift(months=2)` → "in 2 months".
- `test_year` / `test_years` (2236/2245), and `test_granularity` (1944, the explicit-granularity paths) — these don't touch the auto weeks/month boundary but must remain green to prove the change is scoped to the auto branch.

**New cases the fix must make pass (completeness — the bug + the dead branch).** A green existing suite is necessary, not sufficient; the suite currently has no test in the 15–29-day auto window, which is exactly why the bug shipped. I'd verify:
- 15 days → "in 2 weeks" (the reported bug; the day-15 edge).
- 16 days → "in 2 weeks" (the user's literal example).
- 21 days → "in 3 weeks" and 24–28 days → "in 4 weeks" — proves the **previously-dead `weeks` plural branch (1253–1255) is now reachable**. This is the completeness check that distinguishes a real fix from one that merely shifts the off-by-one.
- 14 days → still "in 2 weeks" (lower boundary unchanged).
- ~30 days / `months=1` → still "in a month" (upper boundary intact, no over-correction swallowing real months).
- Past direction: −15 days → "2 weeks ago" (symmetry, currently "a month ago").
- Anchor robustness: re-run the 14/15/16-day probe from multiple anchors incl. a short month (e.g. 2026-02-20) and month/year boundaries (2025-12-31), to confirm the fix isn't anchor-sensitive — the bug wasn't, and the fix shouldn't introduce sensitivity.
- Locale spot-check: run the same boundary cases under at least one non-English locale to confirm the routing change (not the strings) is what moved, since `describe("weeks", ...)` vs `describe("month", ...)` now fires for different inputs.

**How I'd confirm I fixed the true cause, not a symptom:** re-run the days 7–40 bucket map (the command from P1 Step 4). A correct fix turns the current `2 weeks <- day 14 only` / `a month <- 15..40` into a monotonic ramp where days 14–~20 read "2 weeks", ~21 read "3 weeks", ~24–28 read "4 weeks", and "a month" begins near a true 30-day/calendar-month delta — i.e. the "weeks" band is wider than one day and the dead branch is alive. If the map still collapses 15+ straight to "a month", the change addressed a symptom, not the ordering/bump root cause.

Final note on the one claim most likely to be wrong (per honesty rule): the *exact* week→month cutover (does 24–29 days say "4 weeks" or "a month"?) depends on the maintainers' intended UX and on `_SECS_PER_MONTH = 30.5 days` vs calendar-month rounding; I'd get that boundary decision confirmed before locking test assertions for the 24–30-day window. The 15–16-day → "2 weeks" fix itself is unambiguous and is the core of the report.
