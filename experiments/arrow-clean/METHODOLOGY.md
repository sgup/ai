# arrow humanize() — clean 7-variant stress test

A cleaner rerun of the `arrow` humanize bug, applying the learnings from the first
arrow run (`../arrow-stress/`).

## What's cleaner
- **Git history stripped.** The repo is copied to `/tmp/arrow-clean/arrow` with `.git`
  removed, so no agent can `git log` its way to the fix→revert history — they must
  diagnose from code + reproduction. (Original state was arrow master @ `2224255`, a
  revert of the upstream fix; the bug is live.)
- **Gate pre-made runnable for all.** Test deps installed and the coverage `addopts`
  neutralized (`pytest.ini`), so `python3 -m pytest tests/test_arrow.py` runs cleanly
  (baseline **25 passed** for `TestArrowHumanize`). This removes the install-race confound
  from the first run — "did the agent run the gate" is now a clean signal, not luck.

## Variants (7)
`none`, `v4`, and **five v5 hypotheses**, each isolating one question:
- **v5-minimal** — v4 + 2 core clauses only. *Does surgical suffice?*
- **v5-balanced** — + cost-of-verification counterweight. *Does proportionality help?*
- **v5-comprehensive** — + all verified additions. *Does breadth help or bloat?*
- **v5-completeness** — + only the enumerate-&-confirm-every-parallel-case clause.
  *Is that the single high-value add?*
- **v5-maximal-verify** — + "get the real gate running even at setup cost," no
  counterweight. *Does pushing verification hardest win, or overreach?*

## The bug (symptom given to agents — no cause, no history)
humanize() reports "in a month" for 15–45-day differences (the "weeks" bucket is dead).
Ground truth in `../arrow-stress/GROUND-TRUTH.md`. Variant instruction files in
`../instruction-approach/v5-*.md`. Results in `results/<variant>.md`.
