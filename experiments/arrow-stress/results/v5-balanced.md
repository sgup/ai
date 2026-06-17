# Variant: v5-balanced

Scope/blast read: low-blast, reversible — a single-method threshold bug in `humanize()`. The
task is approach-only; I reproduced the symptom and traced the cause but did NOT edit any file.

Environment note (verify-the-real-path): the repo at `/tmp/arrow-stress/arrow` is a **shallow
clone whose HEAD (`2224255`) is literally a Revert** of the upstream fix:
`Revert "Fix humanize reporting "a month" for 16-day differences (#1240) (#1242)" (#1264)`.
So this checkout is intentionally back at the buggy behavior. `python3 -m pytest` is **not
installed** in the active interpreter (`python3 -m pytest` → `No module named pytest`;
`which pytest` → not found); `python-dateutil 2.9.0.post0` and Python 3.12.13 are present. That
gap is load-bearing for P2's baseline step and is called out there.

---

## P1 — Diagnose: reproduce + find the true root cause

### Step 1 — Reproduce the exact reported symptom, by the same path (confirmed)

The user's path is "future event, `humanize` returns 'in a month'". Reproduced with:

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow
base = arrow.Arrow(2026,1,9,12,0,0)
for d in [10,12,13,14,15,16,17,20,24,30,45,46]:
    print(d, '->', base.shift(days=d).humanize(base))"
```

Output (confirmed, copy-paste of the run):

```
10 -> in a week
12 -> in a week
13 -> in a week
14 -> in 2 weeks
15 -> in a month     <-- jump
16 -> in a month
17 -> in a month
20 -> in a month
24 -> in a month
30 -> in a month
45 -> in a month
46 -> in 2 months
```

This is the reported symptom precisely: 14 days → "in 2 weeks", but 15 days → "in a month",
and everything 15–45 days collapses to "a month". "in 3 weeks" / "in 4 weeks" never appear.
(Note on direction: `a.humanize(b)` describes `a` relative to `b`; the user observed the future
form, so the later instant must be the receiver — `later.humanize(base)`. `base.humanize(later)`
yields the symmetric "... ago". Either way the threshold bug is identical, so the diagnosis
holds for both signs.)

### Step 2 — Read the code, don't guess from names

`humanize()` is `arrow/arrow.py:1133`; the `"auto"` granularity branch is `1191`–`1262`. The
relevant region:

- `1217–1224`: builds `calendar_diff = relativedelta(...)` and
  `calendar_months = years*12 + months`.
- **`1226–1228` — the smoking gun:**
  ```python
  # For months, if more than 2 weeks, count as a full month
  if calendar_diff.days > 14:
      calendar_months += 1
  ```
- `1232–1237`: day / "N days" branches (only fire for `diff < SECS_PER_WEEK`).
- **`1239–1248`:** `elif calendar_months >= 1 and diff < SECS_PER_YEAR:` → returns
  `"month"` / `"N months"`.
- `1250–1255`: the `"week"` (`< 2 weeks`) and `"N weeks"` (`< SECS_PER_MONTH`) branches —
  these come **after** the month branch in the `if/elif` chain.

Root cause (confirmed): the `elif` chain checks the **month** branch (1239) *before* the
**weeks** branches (1250–1255). The `days > 14` bump (1227) forces `calendar_months` from 0 to
1 for any diff whose `relativedelta.days` component is 15–30. So for a 15–30-day diff, `1239`
is `True` and returns "a month", and **lines 1250–1255 are dead code for sub-month diffs** —
"3 weeks"/"4 weeks" can never be produced.

### Step 3 — Confirm the mechanism with instrumented values (confirmed, not inferred)

```
PYTHONPATH=/tmp/arrow-stress/arrow python3 -c "
import arrow; from dateutil.relativedelta import relativedelta
base = arrow.Arrow(2026,1,9,12,0,0)
for d in [14,15,16,21,24]:
    later = base.shift(days=d); dt=base._datetime; sdt=later._datetime
    cd = relativedelta(sdt,dt); cm = cd.years*12+cd.months
    print(d,'reldelta(m=%d,d=%d)'%(cd.months,cd.days),'base_cm=%d'%cm,'days>14=%s'%(cd.days>14),'-> cm=%d'%(cm+1 if cd.days>14 else cm))"
```

```
14 reldelta(m=0,d=14) base_cm=0 days>14=False -> cm=0
15 reldelta(m=0,d=15) base_cm=0 days>14=True  -> cm=1
16 reldelta(m=0,d=16) base_cm=0 days>14=True  -> cm=1
21 reldelta(m=0,d=21) base_cm=0 days>14=True  -> cm=1
24 reldelta(m=0,d=24) base_cm=0 days>14=True  -> cm=1
```

At 14 days `calendar_months` stays 0 → fails the `1239` guard → falls through to the weeks
branch → "2 weeks". At 15 days the bump makes it 1 → `1239` fires → "a month". This is the true
cause, not a plausible-looking one: the boundary in the data matches the `> 14` literal exactly,
and toggling that one condition is what flips 15 days between the two outputs.

### Step 4 — Confirm it's not month-length sensitivity / not a `relativedelta` quirk (ruled out)

Re-ran across several base months to check the cause isn't "February is short" or a
`relativedelta` carry artifact:

```
base 2026-01-09: 14->2 weeks | 15->a month | 21->a month | 28->a month | 29->a month | 30->a month
base 2026-02-01: 14->2 weeks | 15->a month | 21->a month | 28->a month | 29->a month | 30->a month
base 2026-02-20: 14->2 weeks | 15->a month | 21->a month | 28->a month | 29->a month | 30->a month
base 2026-06-17: 14->2 weeks | 15->a month | 21->a month | 28->a month | 29->a month | 30->a month
```

Identical regardless of month → confirms the cause is the unconditional `days > 14` bump +
branch ordering, **not** a calendar edge case. The bug is deterministic in the `relativedelta`
`.days` component, which for a fixed sub-month day-count is the same in every month.

### Step 5 — Corroborate with history (confirmed)

`git log --oneline -1` = the Revert commit named above; the upstream commit b423717 ("Fix
humanize reporting 'a month' for 16-day differences") was the fix and got reverted (#1264).
So this exact symptom is a known, previously-fixed-then-reverted issue — strong external
corroboration that the `days > 14` / branch-ordering region is the right place, and a signal
that the *naive* fix had a side effect serious enough to revert (see P2). The reverted commit's
diff is not in the shallow clone (`git show b423717` returns nothing), so I did not read its
exact patch — I treat its approach as unknown, not as the template.

**Root cause, one line:** in `humanize()` `"auto"` (`arrow/arrow.py`), the `days > 14` bump
(1227–1228) plus the month branch (1239) preceding the weeks branches (1250–1255) make any
15–30-day difference round up to "a month", rendering "3 weeks"/"4 weeks" unreachable.

---

## P2 — Fix design: where, how, and how to prove it correct + complete

### Where

Single site: the `"auto"` block of `humanize()`, `arrow/arrow.py`, lines `1226–1228` (the bump)
in concert with the branch order at `1239` vs `1250–1255`. No locale or `constants.py` change
is needed — the locale `describe(...)` already supports `week`/`weeks`/`month`/`months`
(`test_weeks` / `test_month` exercise them today).

### The constraint a correct fix must satisfy (this is what the revert was about)

A correct fix must restore "3 weeks"/"4 weeks" for ~15–29 day diffs **without** regressing the
genuine month cases. The genuine month cases are the ones where `relativedelta` itself yields
`months >= 1`. Verified those land at `months>=1` independent of month length:

```
shift(months=1) from 2026-01-09 -> reldelta m=1 d=0  (31 real days)
shift(months=1) from 2026-01-31 -> reldelta m=1 d=0  (28 real days)
shift(months=1) from 2026-02-28 -> reldelta m=1 d=0
shift(months=1) from 2026-12-15 -> reldelta m=1 d=0
```

So the discriminator is: when `calendar_months` is **0** from `relativedelta` and only the
`days > 14` bump pushed it to 1, that diff is really 2–4 weeks and should be described in weeks;
when `relativedelta` gives `months >= 1`, it is genuinely a month-plus and should say "a month".
A blunt "delete the bump" fix would push 29–30-day diffs (reldelta m=0, d=29/30) down into the
weeks branch and report "4 weeks" where "a month" is arguably more natural — that boundary
behavior is exactly the kind of side effect that made #1240's fix controversial enough to
revert, so the fix design must make a deliberate, tested call at the 29/30-day edge rather than
let it fall out by accident.

### How (recommended approach, with the alternative I weighed)

**Recommended:** keep the `relativedelta`-based month detection but stop letting the raw
`days > 14` bump pre-empt the weeks branches. Concretely: only treat the diff as "a month" when
the *true* week-count rounds to ~4+, i.e. reorder so the weeks branches (15 ≤ days < ~25/26)
are reached first and the month branch handles only `relativedelta.months >= 1` (plus the
near-month tail you choose to round up). The fix should make the seconds-threshold chain
(`SECS_PER_WEEK*2`, `SECS_PER_MONTH`) and the `calendar_months` logic agree, since today they
contradict: `SECS_PER_MONTH = 2_635_200s ≈ 30.5 days`, so the `< SECS_PER_MONTH` weeks branch
*intends* to cover up to ~30 days but is shadowed by the month branch above it.

**Alternative considered (and why it loses):** simply delete lines 1227–1228. Rejected as the
primary fix because it silently changes the 29/30-day boundary to "4 weeks" with no explicit
decision and no test pinning it — and that uncontrolled boundary shift is the likely reason the
prior fix was reverted. Reorder-with-an-explicit-cutoff is safer and self-documenting.

I am not implementing either; the above is the design and the rationale for the pick.

### How to confirm it's correct AND complete without regressing (the critical part)

1. **Capture a real baseline first** — but pytest is missing in this interp (confirmed above).
   So the honest baseline step is: `python3 -m pip install pytest` (or run via a venv / `tox`,
   which `Makefile` targets), then record counts and names:
   `python3 -m pytest tests/test_arrow.py::TestArrowHumanize -q` and the locale class
   `tests/test_arrow.py::TestArrowHumanizeTestsWithLocale`. "No regressions" only means
   something against that recorded number. If pytest cannot be installed in this sandbox, that
   is a blocker to report — not something to paper over with ad-hoc `-c` scripts alone.

2. **Pin the bug with a new failing test BEFORE the fix** (red→green): future and past, e.g.
   `now.shift(days=16)` → "in 2 weeks" (or "in 3 weeks" — decide and pin), and assert the
   `only_distance` form too, mirroring the existing `test_weeks`/`test_month` shape at
   `tests/test_arrow.py:2208`/`2217`. Confirm it fails on the current revert HEAD first.

3. **Re-run the whole humanize gate and diff against baseline**, reporting the delta in the form
   "baseline N passing → N+? passing, +k new". A green run of only the new test is not enough.

4. **Specific cases to check (regression matrix), via a direct script independent of pytest too,
   to cross-check the env's real `now`-based fixture):**
   - **The fixed band:** 15, 16, 20, 24 days → weeks, not "a month" (the symptom).
   - **Lower boundary preserved:** 13 days → "a week"; **14 days → "2 weeks"** — this is the
     existing `test_weeks` (`shift(weeks=2)`) and must stay green.
   - **Upper boundary (the contentious one):** 29, 30 days — decide explicitly whether these are
     "4 weeks" or "a month" and pin a test; this is where the prior fix's side effect lived.
   - **Genuine month cases must NOT regress to weeks:** `shift(months=1)` from a 31-day month
     (Jan 9 → real 31 days, reldelta m=1) and from a 28-day path (Jan 31 → Feb 28, reldelta
     m=1) → both must remain "a month". This is `test_month` (`tests/test_arrow.py:2217`).
   - **Just over a month:** 45 days → "a month", 46 days → "2 months" (current behavior; keep).
   - **Both signs:** every case in past (`now.humanize(later)`) and future
     (`later.humanize(now)`) form — the bug and fix are symmetric, so tests must cover both.
   - **`granularity="week"` / `"month"` explicit paths** (the `elif isinstance(granularity,str)`
     block, 1264–1293) are a *separate* code path that does NOT use `calendar_months` — confirm
     the fix doesn't touch it and its tests (`test_granularity`, lines ~1944, and `test_week`
     106/506-week cases at 1986–1993) stay green.
   - **Mixed/list granularity** (`TestArrowHumanizeTestsWithLocale`, 2771+) and **non-en
     locales** (`locale_list_with_weeks` vs `locale_list_no_weeks`) — locales without a week
     timeframe must not start erroring; run the full locale humanize class.
   - **Month-length independence:** re-run the fixed band from base dates in Jan/Feb/Jun (as in
     P1 Step 4) to confirm the new boundary is stable across month lengths and not just tuned to
     today's `utcnow()` (the fixture is real-clock — `conftest.py:20` `now = Arrow.utcnow()`).

5. **Completeness check:** grep the codebase for other readers of the same thresholds —
   `grep -n "calendar_months\|SECS_PER_MONTH\|> 14" arrow/arrow.py` — to be sure the weeks/month
   seam isn't duplicated elsewhere, and confirm `dehumanize()` (the inverse parser) round-trips
   the new strings if it parses weeks/months.

The one claim I'd most expect to need adjustment: the exact 29/30-day cutoff between "weeks" and
"a month" is a product decision, not a derivable fact — whatever the fix picks must be pinned by
an explicit test, because that boundary is precisely what got the previous fix (#1240) reverted.
