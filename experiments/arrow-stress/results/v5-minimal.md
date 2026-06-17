# Variant: v5-minimal

APPROACH ONLY — no fix implemented. Every load-bearing claim below is marked **confirmed** (with the command/file:line that proves it) or **inferred** (with what would confirm it). All `arrow.py` line numbers are from the clone at `/tmp/arrow-stress/arrow` at commit `2224255` (confirmed: `git rev-parse HEAD`).

## Environment / baseline facts (confirmed)

- Import resolves to the clone: `arrow.__file__ = /tmp/arrow-stress/arrow/arrow/__init__.py`, `arrow.__version__ = 1.4.0` (confirmed: ran `python3 -c "import arrow; print(arrow.__version__, arrow.__file__)"`).
- HEAD commit message is decisive: `2224255 Revert "Fix humanize reporting 'a month' for 16-day differences (#1240) (#1242)" (#1264)` (confirmed: `git log --oneline -1`). **The repo is deliberately sitting on the buggy state — an earlier fix for this exact symptom was merged and then reverted.** This is a pre-existing, known flaw, not an accident.
- `humanize()` is defined at `arrow/arrow.py:1133` (confirmed: `grep -n "def humanize"`).
- Test class `TestArrowHumanize` at `tests/test_arrow.py:1943`, decorated `@pytest.mark.usefixtures("time_2013_01_01")` (line 1942). That fixture (`tests/conftest.py:19-22`) sets `request.cls.now = arrow.Arrow.utcnow()` — i.e. **`self.now` is the real current time, NOT pinned to 2013** despite the name (confirmed: read conftest). Consequence: the calendar-sensitive humanize tests (`test_month`, `test_weeks`, `test_months`) depend on the wall-clock date the suite runs on.
- Clean baseline for the humanize suite: **`25 passed`** in `tests/test_arrow.py::TestArrowHumanize` (confirmed: `pytest tests/test_arrow.py::TestArrowHumanize -q -o addopts=""` after installing `pytz simplejson pytest-mock dateparser`). Note two environment snags any runner must handle: (1) `tox.ini` injects `--cov-fail-under=99` addopts that break a bare `pytest` invocation — pass `-o addopts=""`; (2) test deps `pytz`, `simplejson`, `pytest-mock` (for the `mocker` fixture used by `test_untranslated_granularity`) are not installed by default. Without `pytest-mock` the baseline is `24 passed, 1 error`, the error being purely the missing `mocker` fixture, unrelated to humanize.

---

## P1 — Diagnose: reproduce the symptom and find the TRUE root cause

### Step 1 — Reproduce the reported symptom by the same path (confirmed)

The bug report fixes a wall-clock ("as of Jan 9 2026") and a relative offset. Reproduce with an explicit anchor so it is deterministic (the report's "now" is irrelevant to the math — only the delta and the anchor's calendar position matter):

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
now = arrow.Arrow(2026,1,9,12,0,0)
for d in [13,14,15,16,17,20,28]:
    print(d, '->', now.shift(days=d).humanize(now))
"
```

Confirmed output:

```
13 -> in a week
14 -> in 2 weeks
15 -> in a month
16 -> in a month
17 -> in a month
20 -> in a month
28 -> in a month
```

So the symptom is real and the cliff is sharp: **14 days → "in 2 weeks", 15 days → "in a month".** The report says "16 days"; the true boundary is **15 days** (`> 14`). I also confirmed it is symmetric in the past direction (`-15d → "a month ago"`) and spans the whole 15–30-day band (`+29d`, `+30d`, `+31d` all → "in a month"), and that it does not depend on the anchor month (Feb anchor, a 28-day month, gives the same 15-day cliff). All confirmed by running the loop above with `[15,16,29,30,31]` and a Feb anchor.

### Step 2 — Read the actual code path, don't guess it

`humanize()` with default `granularity="auto"` (confirmed by reading `arrow/arrow.py:1191-1262`). The relevant block:

- `1186` `_delta = int(round((self._datetime - dt).total_seconds()))`; `1188` `delta_second = diff = abs(_delta)`.
- `1213` the second/minute/hour/sub-day ladder returns first for `diff < _SECS_PER_DAY`.
- `1217-1224` builds `calendar_diff = relativedelta(...)` and `calendar_months = years*12 + months`.
- **`1226-1228`:** `# For months, if more than 2 weeks, count as a full month` / `if calendar_diff.days > 14: calendar_months += 1`.
- Then the unit ladder, **in this order**:
  - `1232` `diff < _SECS_PER_DAY*2` → "day"
  - `1235` `diff < _SECS_PER_WEEK` → "N days"
  - **`1239` `elif calendar_months >= 1 and diff < _SECS_PER_YEAR:` → "a month"/"N months"**
  - `1250` `elif diff < _SECS_PER_WEEK*2:` → "week"
  - `1253` `elif diff < _SECS_PER_MONTH:` → "N weeks"
  - `1257`/`1261` → year(s)

The constants (confirmed `arrow/arrow.py:126-133`): `_SECS_PER_WEEK = 86400*7`, `_SECS_PER_MONTH = 86400*30.5`, `_MONTHS_PER_YEAR = 12`.

### Step 3 — Confirm the actual cause (not a plausible-looking one)

Two distinct candidate causes exist; I distinguished them by tracing values, not by eyeballing:

1. **Candidate A — wrong threshold constant** (the report's hypothesis: "thresholds seem off").
2. **Candidate B — branch *ordering*: the month branch is evaluated before the week branches.**

Trace of the actual intermediate values (confirmed by running `relativedelta` directly):

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
from dateutil.relativedelta import relativedelta
import arrow
now = arrow.Arrow(2026,1,9,12,0,0)
for d in [14,15,16]:
    cd = relativedelta(now.shift(days=d)._datetime, now._datetime)
    cm = cd.years*12 + cd.months
    print(d, 'rd.days=', cd.days, 'base_months=', cm, 'after>14 bump=', cm + (1 if cd.days>14 else 0))
"
```

Confirmed:

```
14 rd.days= 14 base_months= 0 after>14 bump= 0
15 rd.days= 15 base_months= 0 after>14 bump= 1
16 rd.days= 16 base_months= 0 after>14 bump= 1
```

So the mechanism is, **confirmed end-to-end**:

- At 15 days, `relativedelta` yields `days=15`, `months=0`. The `calendar_diff.days > 14` line (`1228`) bumps `calendar_months` from 0 → **1**.
- `diff = 15*86400 = 1_296_000` s. `_SECS_PER_WEEK = 604_800`, so `diff` is NOT `< _SECS_PER_WEEK` (1235 skipped). It IS `< _SECS_PER_YEAR`. So the **`elif calendar_months >= 1` branch at 1239 fires** and returns "in a month".
- The week branches at `1250` (`diff < _SECS_PER_WEEK*2 = 1_209_600`) and `1253` (`diff < _SECS_PER_MONTH = 2_635_200`) are **unreachable** for any delta in roughly the 15–30-day band, because the month branch above them already returned. They are dead code for that range.

**This is Candidate B, confirmed.** The root cause is the **ordering/structure of the unit ladder** combined with the over-eager `days > 14` bump at line 1228 — not a single mis-set numeric threshold. Two independent proofs that it is ordering, not the constant:

- The "N weeks" branch at `1253` *does* exist and *would* produce "in 2 weeks" for 15 days (`15*86400 < 30.5*86400`), but it sits *after* the month branch, so it can never run for that input. The capability is present and shadowed — the signature of an ordering bug, not a missing/wrong threshold.
- Changing the constant at `1228` (e.g. `> 14` → `> 25`) would only move the cliff, not fix the structural fact that "a month" is reachable for sub-month deltas before "N weeks" is. (inferred — I did not edit the file per instructions; confirmable by the trace above showing the month branch precedes the week branches regardless of the bump value, for any delta ≥ ~7 days where `calendar_months` becomes ≥ 1.)

Why I trust this over the report's "thresholds are off" framing: I reproduced the exact symptom, then traced every intermediate (`relativedelta.days`, `calendar_months`, `diff` vs each constant) and watched which `return` executes. The returning branch is line 1239, reached *because* it is ordered ahead of the week branches — that is the real cause. The `# more than 2 weeks → a full month` comment at 1226 makes the intent explicit and shows it is behaving as written, just wrongly specified.

**Provenance gap (named honestly):** the reverted fix commit `b423717da81aaf8117313b4b377efaa6413a9639` (referenced in the HEAD revert message) is **not present in this shallow clone** — `git cat-file -t b423717` returns `could not get object info` (confirmed). So I could not read the prior fix's exact diff or the maintainers' stated reason for reverting it. That history (PRs #1240/#1242 = fix, #1264 = revert) is the single most important thing to read before designing a fix, because the revert means a naive re-fix may reintroduce whatever regression caused the rollback. This is the one input I'd most want and couldn't get from the clone; I'd fetch it via `git fetch --unshallow` or read PRs #1240/#1242/#1264 on GitHub.

---

## P2 — Fix design: where, how, and how to confirm correct + complete without regressing

### Where

`arrow/arrow.py`, the `granularity == "auto"` ladder, **lines ~1217–1255** — specifically the relationship between the `days > 14` bump (1228) and the position of the month branch (1239) relative to the week branches (1250, 1253). This is the only site involved (confirmed: the trace returns from 1239; no other code path participates).

### How (design, not implemented)

The fix must make a sub-month delta resolve to weeks before it resolves to a month. The cause is structural, so the fix should be structural. Recommended option, with the alternatives I weighed:

- **Recommended — gate the month branch on a real month-magnitude, and/or order weeks before months.** Make "a month" reachable only when the delta is genuinely ~a month, i.e. require `calendar_months >= 1` to be backed by an actual month boundary (`relativedelta.months >= 1` or `diff >= _SECS_PER_MONTH`), OR move the two week branches (1250, 1253) ahead of the month branch (1239) so 15–30-day deltas fall through to "N weeks". Concretely, the cleanest is to tighten line 1228 so the `> 14` bump no longer manufactures a phantom month for a 15-day delta, and ensure the week branches precede the month branch. Expected result: 15 days → "in 2 weeks", 16 days → "in 2 weeks", ~28–30 days → "in 4 weeks", and only a true calendar-month delta → "a month".
- **Rejected — just change the `> 14` constant** (e.g. to `> 25`). Moves the cliff without fixing the structure; "a month" would still be reachable ahead of "N weeks" and you'd get a new wrong band (e.g. 26–30 days). Treats a symptom.
- **Rejected — drop the `calendar_months` bump entirely.** Risks regressing the legitimate "round 29–31 days up to a month" intent the comment at 1226 encodes; needs the calendar history to judge, which the revert suggests is load-bearing.

**Before writing any of this, read PRs #1240/#1242/#1264** (the fix-then-revert) to learn the regression that got the prior fix rolled back, and design around it. I would not implement until that is read (the revert is a strong signal the obvious fix has a known failure mode).

### How to confirm the fix is correct AND complete, without regressing

1. **Re-establish the baseline first.** `pytest tests/test_arrow.py::TestArrowHumanize -q -o addopts=""` → must show the recorded **`25 passed`** before any change. (confirmed baseline = 25 passed.) Because `self.now = utcnow()`, also record the date the baseline ran (2026-06-17 here) — calendar-sensitive cases can shift with the run date.

2. **Reproduce → re-run the exact symptom inputs** after the change, by the same path used in P1: the `shift(days=d)` loop for `d ∈ {13,14,15,16,17,20,28,29,30,31}` from a fixed anchor, in **both** directions (`+d` and `-d`). Correct target: 15–~27 days → "in N weeks" (not "a month"); the month should appear only at a true month-scale delta. Confirm the past direction symmetrically (it is currently broken symmetrically — `-15d → "a month ago"`).

3. **Name the specific cases that must still hold (regression set):**
   - **Lower edge — weeks must survive:** `test_week` (`shift(weeks=1)` → "in a week", `tests/test_arrow.py:2199`) and `test_weeks` (`shift(weeks=2)` → "in 2 weeks", line 2208). These are the branches currently shadowed; the fix must make them reachable for raw-day deltas too, without breaking the exact `weeks=1/2` shifts.
   - **Days edge:** `test_days` (line 2180) — `shift(days=2/3/4)` must still say "N days"; `days=7` boundary must not flip to weeks early.
   - **Upper edge — month must NOT disappear:** `test_month` (`shift(months=1)` → "in a month", line 2217) and `test_months` (`shift(months=2)` → "in 2 months", line 2226). Verify on multiple anchor months including a 28-day Feb and a 31-day month, because `relativedelta` makes `months=1` span 28–31 actual days — the fix must keep a true 1-calendar-month shift mapping to "a month" even though 28–30 *raw* days should map to weeks. This calendar/raw-day tension is exactly what likely tripped the reverted fix, so it is the highest-risk case.
   - **`granularity="week"` and `granularity="month"` explicit paths** (`test_granularity`, lines 1944-2016, including `later106`/`later506` asserting "4 weeks"/"a month"/"18 months"). The auto fix touches only the `"auto"` block (1191-1262); the explicit-granularity block (1264+) is separate, so these should be untouched — confirm by running them.
   - **Year boundary:** `shift(days=364/365/366)` and `test_year`/`test_years` (lines 2236-2249) — ensure no off-by-one leaks at the top of the ladder.
   - **Locale path:** `TestArrowHumanizeTestsWithLocale` (line 2345) — the fix returns the same locale keys ("week"/"weeks"/"month"/"months"), so localized output should follow; run this class too.

4. **Run the whole gate and report the delta, not a grep.** `pytest tests/test_arrow.py -q -o addopts=""` and `pytest tests/test_locales.py -q -o addopts=""`; report as "baseline 25 passed in TestArrowHumanize → now N passed, deltas: …", and account for any case that legitimately *changes* (e.g. a new "in 2 weeks" expectation at 15 days is a desired change, not a regression — it would require updating/adding an assertion, which is part of "complete"). A green suite alone is **not** sufficient here: the current tests pass *with the bug present* (25 passed today), which proves there is **no test covering the 15–30-day raw-day band**. So "complete" requires **adding** assertions for `shift(days=15)`, `shift(days=16)`, `shift(days=20)`, `shift(days=28)` (and their negatives) — otherwise the fix is unguarded and a future revert (exactly what happened here) goes undetected.

5. **Confirm it is the *real* fix, not a coincidence of today's date.** Because `self.now=utcnow()`, run the symptom probe against several fixed anchors (start of a 31-day month, start of Feb, a leap-Feb) so a green result isn't an artifact of 2026-06-17's calendar. (confirmed the bug is anchor-independent in P1; the fix's correctness should be re-confirmed the same way.)

**The one claim I'd most expect to need correction:** that tightening the `days > 14` bump / reordering the branches cleanly fixes 15–30 days *without* breaking the `shift(months=1)` ⇒ "a month" case across all anchor months — because the reverted PR #1240/#1242 targeted this exact symptom and was rolled back, implying the obvious fix has a known regression. I would read that history before implementing and treat the month-boundary calendar cases (28-day Feb vs 31-day month) as the make-or-break test set.
