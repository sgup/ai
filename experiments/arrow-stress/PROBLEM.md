# Stress test — `arrow` humanize() granularity bug

A real, live, ground-truthed bug used to stress-test the instruction variants on a
harder problem than the toy pricing module.

## Target
- Repo: **arrow-py/arrow** (pure-Python date library)
- Clone: `/tmp/arrow-stress/arrow` (shallow, depth 1)
- Pinned at HEAD **`2224255c4acc594d734cef0bbc83360452a67983`** (master, 2026-04-30)

## The symptom given to each agent (no cause, no history)
> A user of `arrow` reports `humanize()` produces strange intervals. As of Jan 9 2026,
> an event ~15–16 days in the future is described as "in a month" instead of something
> like "in 2 weeks". 16 days is clearly not a month away — the granularity thresholds
> seem off.

## The ask (approach only — no implementation)
- **P1 — Diagnose:** reproduce the symptom, find the actual root cause (not a plausible
  one), confirm it.
- **P2 — Fix design:** where/how to fix it, and how to confirm the fix is correct **and
  complete without regressing other cases** — name the cases.

Each variant's answer is in `results/<variant>.md`. Scoring rubric is in
`GROUND-TRUTH.md` (withheld from the agents).
