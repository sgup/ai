# Ground truth — withheld from the agents (scoring reference)

## Reproduced at HEAD 2224255
`arrow.Arrow(2026,1,9).shift(days=d).humanize(arrow.Arrow(2026,1,9))`:

```
+13 -> 'in a week'    +14 -> 'in 2 weeks'
+15 -> 'in a month'   +16 -> 'in a month'   +17 -> 'in a month'
+20 -> 'in a month'   +25 -> 'in a month'   +28 -> 'in a month'
+31 -> 'in a month'   +45 -> 'in a month'
```

So the bug is **not** "16 days → a month" in isolation: **every delta from ~15 to ~45
days collapses to "in a month."** The "weeks" granularity bucket is effectively **dead**
for sub-month differences. (Note: the actual boundary here is 14/15, not the report's
15/16 — the report's exact numbers should be treated as needing verification, not trusted.)

## Root cause (arrow/arrow.py)
- **Line 1227:** `if calendar_diff.days > 14: calendar_months += 1` bumps
  `calendar_months` 0→1 whenever leftover days exceed 14, **even when no calendar-month
  boundary was crossed.**
- **Branch order:** the month branch (`elif calendar_months >= 1 and diff < _SECS_PER_YEAR`,
  ~line 1239) is tested **before** the week/weeks branches (~lines 1250–1255). Once the
  bump makes `calendar_months >= 1`, the weeks bucket is unreachable.

## Real history (the minefield — why this is a good stress test)
- Issue **#1240** reported it. PR **#1242** fixed it (guard the bump with
  `calendar_months >= 1`, reorder weeks-before-months). PR **#1264** **reverted #1242**
  with **no stated reason** → the bug is live again. A careful fix to this exact branch
  logic was reverted, so the area is fragile and a naive patch likely regresses other
  buckets.

## Scoring rubric — what separates a rigorous approach
1. **Reproduce by running**, not reading — and notice the real boundary (14/15) differs
   from the report (15/16); treat the report's numbers as needing verification.
2. **See the range, not the one date** — discover 15–45 days all say "a month," i.e. the
   weeks bucket is dead (the "confirm every parallel path/bucket" instinct).
3. **Trace to the `>14` bump + branch ordering** (don't guess from names).
4. **P2 regression awareness:** verify a fix across ALL buckets *and* true month-boundary
   cases (e.g. Feb 8 → Mar 8 = 28 days SHOULD remain "a month") — the trap that gets naive
   fixes reverted. Bonus: discover the prior fix/revert history.
5. Confirmed/inferred labeling, test baseline, gating, "the claim most likely wrong."
