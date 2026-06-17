# Variant: v5-maximal-verify

Approach only — no fix implemented, no source files edited. All claims below are marked **[confirmed]** (I ran it / read it) or **[inferred]** (reasoned, not executed). Environment: `/tmp/arrow-clean/arrow`, arrow `1.4.0` **[confirmed: `python3 -c "import arrow; print(arrow.__version__)"`]**, Python 3.12.13 **[confirmed]**. Baseline test gate: `225 passed in 0.52s`, 0 failing **[confirmed: `python3 -m pytest tests/test_arrow.py -q`]**.

---

## P1 — Diagnose: reproduce the symptom, find the true root cause

### Step 1 — Reproduce the reported symptom by the same path, same inputs

The report: "As of Jan 9 2026, an event ~15-16 days in the future is described as 'in a month' instead of 'in 2 weeks'." I reproduced it verbatim **[confirmed]**:

```
PYTHONPATH=/tmp/arrow-clean/arrow python3 -c "
import arrow
now = arrow.Arrow(2026, 1, 9)
for d in [13,14,15,16,20]:
    later = now.shift(days=d)
    print(d, 'days future ->', later.humanize(now))"
```

Output **[confirmed]**:
```
13 days future -> in a week
14 days future -> in 2 weeks
15 days future -> in a month   <-- symptom
16 days future -> in a month   <-- symptom (matches report exactly)
20 days future -> in a month
```

So "2 weeks" appears **only at exactly 14 days**, then it jumps straight to "a month" at 15. The user's expectation (15-16 days → "2 weeks") is reasonable and the output is wrong.

### Step 2 — Rule out the red herring in the report

The "Jan 9 2026" framing is a distraction. I checked the same 16-day gap from three unrelated base dates **[confirmed]**:
```
2026-01-09 -> in a month
2026-06-17 -> in a month
2020-03-01 -> in a month
```
The bug is **date-independent** — it is purely a function of the *gap size*, not the calendar position. This matters: it tells me not to go hunting for anything date- or DST-specific, and that a single fixed-gap unit test will reproduce it deterministically.

### Step 3 — Read the code path that produces it

The `humanize()` method is `arrow/arrow.py:1133`. For `granularity="auto"` (the default), the day-and-above logic is **lines 1217-1262** **[confirmed: read]**. The relevant fragment:

```python
1217  calendar_diff = (relativedelta(dt, self._datetime) if self._datetime < dt
1218                   else relativedelta(self._datetime, dt))
1222  calendar_months = calendar_diff.years * self._MONTHS_PER_YEAR + calendar_diff.months
1226  # For months, if more than 2 weeks, count as a full month
1227  if calendar_diff.days > 14:
1228      calendar_months += 1
1230  calendar_months = min(calendar_months, self._MONTHS_PER_YEAR)
...
1235  elif diff < self._SECS_PER_WEEK:                       # < 7 days  -> "N days"
1237      ...
1239  elif calendar_months >= 1 and diff < self._SECS_PER_YEAR:   # MONTH branch
1240      if calendar_months == 1: return ... "month"
1245      else: ... "months"
1250  elif diff < self._SECS_PER_WEEK * 2:                   # WEEK branch ("a week")
1251      return ... "week"
1253  elif diff < self._SECS_PER_MONTH:                      # WEEKS branch ("N weeks")
1255      return ... "weeks"
```

### Step 4 — Instrument the branch decision to confirm the *actual* cause (not a plausible one)

A name-level guess would be "the thresholds are off." To confirm the *mechanism*, I instrumented the exact intermediate values the method computes, for 14/15/16 days **[confirmed]**:

```
14d: relativedelta days=14 | calendar_months base=0 bumped=0 | diff=1209600s
15d: relativedelta days=15 | calendar_months base=0 bumped=1 | diff=1296000s
16d: relativedelta days=16 | calendar_months base=0 bumped=1 | diff=1382400s
```

And I walked the branch sequence for the 16-day case explicitly **[confirmed]**:
```
diff(16d) = 1382400
  < SECS_PER_DAY*2  ? False
  < SECS_PER_WEEK   ? False
  calendar_months>=1 and diff<SECS_PER_YEAR ?  True   <-- MONTH branch fires here
  (week branch, never reached) < SECS_PER_WEEK*2 ? False
```

**Root cause — confirmed, two interacting facts:**

1. **The `calendar_diff.days > 14` bump (line 1227-1228)** turns *any* gap of 15+ days into `calendar_months = 1`, because for a sub-month gap `relativedelta.days` equals the whole day-count (years=months=0). At 15 days, `days=15 > 14` → `calendar_months` becomes 1.

2. **Branch ordering (line 1239 before lines 1250/1253).** The `elif calendar_months >= 1 ...` MONTH branch sits *above* both WEEK branches. So the moment the bump makes `calendar_months == 1`, the month branch wins and the "a week"/"N weeks" branches at 1250/1253 become **unreachable** for the entire 15-20 day window. I confirmed the would-be week branch would have returned `max(diff // SECS_PER_WEEK, 2) == 2` ("2 weeks") for 16 days **[confirmed]** — exactly the output the user expected.

This is the true cause, confirmed by execution and by tracing the call chain, not inferred from names. The comment on line 1226 ("if more than 2 weeks, count as a full month") shows the threshold was a deliberate-but-wrong design choice: "more than 2 weeks" (15+ days) is being rounded up to a full month, which is the granularity error the user is reporting.

**Honest naming of the pre-existing flaw:** the `> 14` constant is not a neutral "convention" — it is the defect. Treating 15 days as a full month is the bug, not a quirk to build around.

### How I confirmed it is the *actual* cause, not a plausible-looking one
- I reproduced the exact reported output (`in a month` at 15/16 days) **[confirmed]**, not a cousin.
- I instrumented the real intermediate values (`calendar_months` flipping 0→1 at the 14→15 boundary) **[confirmed]**, so I can point to the precise line that flips the decision.
- I confirmed the week branches are *unreachable*, not merely "also wrong," by evaluating each `elif` condition in order for the failing input **[confirmed]**.
- I confirmed date-independence **[confirmed]**, ruling out DST/calendar theories.

---

## P2 — Fix design: where, how, and how to prove it's correct AND complete without regression

### The regression trap (why the "obvious" fix is wrong)

The tempting fix is to **reorder** — move the WEEK branches above the MONTH branch. I modeled this in pure Python replicating the exact branch logic and ran it against both the bug inputs and the *existing test inputs* **[confirmed]**:

| input | CURRENT | reorder-only |
|---|---|---|
| 15 days | month | **2 weeks** (fixes bug) |
| 16 days | month | **2 weeks** (fixes bug) |
| `shift(months=1)` (≈30d gap) | month | **4 weeks** ← REGRESSION |
| `shift(months=2)` | 2 months | 2 months |

Reordering breaks the existing `test_month` (`tests/test_arrow.py:2217`), which asserts `shift(months=1)` → `"a month"`. The day-gap of `shift(months=1)` from *now* is 30 days **[confirmed]**; under reordering the "N weeks" branch (`diff < SECS_PER_MONTH`, where `SECS_PER_MONTH = 30.5 days`) catches 30 days first and returns "4 weeks". So **reorder-only is incorrect-and-incomplete: it fixes the symptom but regresses a documented, tested behavior.**

### Recommended fix: raise the bump threshold, keep the ordering

**Where:** `arrow/arrow.py:1227`, the single line `if calendar_diff.days > 14:`.

**How:** raise the threshold so a sub-month gap is only rounded up to a month near a genuine month boundary (≈3 weeks), e.g. `if calendar_diff.days > 21:`. This keeps the existing branch order intact, so no other branch's reachability changes. I modeled `threshold=21` against the full input set **[confirmed]**:

| input | result under threshold=21 |
|---|---|
| 14 days | 2 weeks |
| 15 days | **2 weeks** (bug fixed) |
| 16 days | **2 weeks** (bug fixed) |
| 20 days | **2 weeks** (bug fixed) |
| 21 days | 3 weeks |
| 22-30 days | month |
| `shift(months=1)` (30d) | **a month** (preserved) |
| `shift(months=2)` | **2 months** (preserved) |

Full day sweep 8→40 days under threshold=21 is monotonic **[confirmed]**: `week` (8-13) → `2 weeks` (14-20) → `3 weeks` (21) → `month` (22+). This fixes the bug and preserves every value the existing month/weeks tests lock in.

**Why this over reordering:** it is the minimal change that (a) fixes the reported window, (b) does not alter branch reachability, and (c) keeps `months=1`/`months=2` exact. Lead recommendation: **threshold bump**. Alternative considered and rejected: branch reorder (regresses `test_month`). A third option — reorder *and* shrink `SECS_PER_MONTH`'s role — is larger blast radius and not needed.

**Residual quirk to flag honestly (not introduced by the fix, narrowed by it):** under threshold=21, "3 weeks" appears only at *exactly* 21 days, because once a full calendar month is crossed `calendar_diff.days` resets toward 0 and the month branch takes over at 22 days. The same class of discontinuity exists today (it's why "2 weeks" only showed at exactly 14). The threshold bump shrinks the misclassified window from 15-20 days down to nothing in the reported range, but does not fully linearize the week→month transition. A complete linearization would require reworking the `calendar_months` bump to compare against `SECS_PER_WEEK`-based boundaries rather than `relativedelta.days`; that is a larger design change and I'd scope it as a follow-up, not fold it into this fix. **[inferred from the model; would confirm by reading the resulting outputs after the change.]**

### How I'd confirm the fix is correct AND complete (without regressing)

1. **Capture the real baseline first** (done): `225 passed, 0 failing` via `python3 -m pytest tests/test_arrow.py -q` **[confirmed]**. "No regressions" is measured against this exact number.

2. **Re-run the full suite after the change** and diff: it must stay `225 passed`, same names. A green run is necessary, not sufficient — so also assert the specific cases below.

3. **Assert the fixed window** (the reported symptom, by the same path): for a fixed base, `humanize` of +15, +16, +20 days → `"in 2 weeks"` (currently `"in a month"`). This is the reproduction turned into a guard.

4. **Assert the boundaries are not over-corrected** — the cases most likely to flip under any threshold change:
   - `+14 days` → `"in 2 weeks"` (must stay; it's the lower edge).
   - `+21 days` → `"in 3 weeks"` (the new transition point).
   - `+22 days` → `"in a month"` (month must still start here).
   - `shift(months=1)` → `"a month"` / `"in a month"` — this is existing `test_month` (line 2217), the one reorder breaks. Re-run it explicitly.
   - `shift(months=2)` → `"2 months"` — existing `test_months` (line 2226).
   - `shift(weeks=2)` → `"2 weeks"` — existing `test_weeks` (line 2208).
   - `shift(weeks=1)` → `"a week"` — existing `test_week` (line 2199) and `test_week_limit` (line 2297, regression test for issue #848).
   - `shift(years=1)` / `years=2` → `"a year"` / `"2 years"` — existing `test_year`/`test_years` (lines 2236, 2245): confirm the month→year handoff is untouched (it is — the fix never touches the year branches **[inferred from reading lines 1257-1262]**).

5. **Symmetry check** — past *and* future, since the sign path is shared (`sign` at line 1187): assert both `now.humanize(later)` (e.g. `"2 weeks ago"`) and `later.humanize(now)` (`"in 2 weeks"`) for +15/+16 days. The bug reproduces in both directions **[confirmed]**, so the fix must too.

6. **`only_distance=True`** variants (the existing tests at lines 2205-2206, 2214 cover this) — confirm `"2 weeks"` with no `in`/`ago`.

7. **Locale spot-check** — the same code path feeds all locales via `locale.describe(...)`; re-run `TestArrowHumanizeTestsWithLocale` (starts line 2345) to confirm no locale-specific week/month assertion shifted. **[inferred: the fix changes only the English-agnostic branch selection, so locale outputs should track; confirmed only by re-running that class.]**

**Definition of complete:** the suite is back at `225 passed` with the same test names, the four boundary cases (14→2wk, 21→3wk, 22→month, 30/months=1→month) hold, the reported 15/16/20-day window now says "2 weeks" in both directions, and I've named the residual 21→22 day discontinuity as a known limitation rather than claiming a fully linear scale.

---

### Status
- **Confirmed by execution:** reproduction of the exact symptom; date-independence; the `calendar_diff.days > 14` bump flipping `calendar_months` 0→1 at the 14→15 boundary; the month branch (line 1239) preempting the unreachable week branches (1250/1253); the reorder fix regressing `test_month`; the threshold=21 fix fixing the window while preserving `months=1`/`months=2`/`weeks=2`; baseline `225 passed`.
- **Inferred (not executed):** the full post-fix suite staying green and the locale class being unaffected (I modeled the branch logic in standalone Python rather than patching the read-only source, per the no-edit constraint); the residual 21→22 discontinuity characterization.
- **The one claim I'd most expect to be wrong:** that *no* locale-specific test asserts a value inside the 15-21 day window — I modeled English only; the locale class at line 2345 must actually be re-run after the change to be sure.
- No files were edited; the candidate fixes were evaluated by replicating the branch logic in a separate process, not by patching `arrow/arrow.py`.
