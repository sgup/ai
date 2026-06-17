# arrow humanize() — clean 7-variant comparison

Seven variants (none, v4, and 5 v5 hypotheses) on the same live `arrow` bug, with the
methodology cleaned up (git history stripped → no minefield freebie; test deps
pre-installed → gate runnable by all). Approach-only. Full answers in `results/`; rubric
in `../arrow-stress/GROUND-TRUTH.md`.

## Headline

All seven nailed the **core** diagnosis again (reproduce by running, find the dead
"weeks" band, trace to the `>14` bump + branch ordering with instrumentation, disprove
the date red-herring). With the clean setup, the differentiation is now almost entirely
in **P2 — how rigorously they verify the *fix*** — and there one hypothesis pulled clearly
ahead.

## The decisive differentiator: did they *execute* the fix-verification?

| Behavior | none | v4 | min | bal | comp | compl | **maxv** |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| Ran the pytest baseline (225 passed) | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| confirmed/inferred + "most likely wrong" | ✗ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Disproved the date red-herring (multi-anchor) | ~ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Named the product/UX cutover fork | ~ | ✓ | ✓ | ✓✓ | ✓ | ✓ | ✓ |
| Most exhaustive case **enumeration** | ~ | ✓ | ✓ | ✓ | ✓ | ✓✓ | ✓ |
| **Modeled a candidate fix and ran it** | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✓✓ |
| **Found the obvious fix (reorder) REGRESSES `test_month`** | ✗ | ✗ | ✗ | ✗ | ~ | ✗ | ✓✓ |

## The standout: v5-maximal-verify

Only **maximal-verify** turned "a fix must not regress `test_month`" from a *plan* into an
*executed finding*. It modeled both candidate fixes in standalone Python and ran them
against the real test inputs:

- **Reorder weeks-before-months** (the obvious fix) → `shift(months=1)` (a 30-day month)
  falls into the weeks branch (`30d < 30.5d = _SECS_PER_MONTH`) → **"4 weeks", regressing
  `test_month`.**
- **Raise the bump threshold to `>21`, keep the ordering** → fixes 15–20 days *and*
  preserves `months=1`→"a month", `months=2`→"2 months", `weeks=2`→"2 weeks".

That is the **exact trap that got the real upstream fix (#1242) reverted** — and
maximal-verify rediscovered it *with the git history stripped*, purely by executing
candidate fixes. No other variant verified which fix regresses; they all correctly said
"don't regress `test_month`" but stopped at the plan. **v5-comprehensive** was the only
other one to model a fix (delete-the-clause, and it verified `test_month` survives because
`calendar_months` comes from the months term, not the bump) — also excellent, just a less
adversarial choice of candidate.

## What each hypothesis showed

- **minimal / balanced:** solid and (balanced) concise; balanced named the UX cutover fork
  best. Neither modeled the fix — they reasoned about regressions rather than executing the
  check.
- **completeness:** the enumerate-every-case clause fired hardest — an hour-resolution
  sweep, an explicit falsification check, and the sharpest "the suite is green *with the bug
  present*, so completeness means *adding* the missing cases." Best at naming the full case
  set — but it stopped at enumerating, didn't *run* a candidate fix against them.
- **comprehensive:** modeled the fix and verified `test_month` survives for the right
  reason. Breadth paid off; still the longest.
- **maximal-verify:** modeled and ran *competing* fixes, caught the regression, proposed and
  verified a safe one, and honestly flagged the residual 21→22-day discontinuity it does
  *not* fully fix. Deepest, most decision-ready result of the seven.

## The real lesson (for v5)

The two clauses that mattered most are **complementary**, and the best output would combine
them:
- **completeness** → *enumerate* the full set of cases a fix must satisfy and not regress.
- **maximal-verify** → *actually run the candidate fix* against that set, rather than
  reasoning about what it would do.

Together they convert "a fix must not regress X" into "I ran the obvious fix; it regresses
X; here's one that doesn't." That is the single highest-value behavior for a correctness
fix, and it's what separated the top result from a field that was otherwise excellent.

The cost-of-verification counterweight (**balanced**) kept output proportionate and surfaced
the product fork well, but here it slightly *under-pushed* — it didn't reach the
model-and-run-the-fix depth. Worth keeping for proportionality, but it shouldn't dampen
execution on a high-stakes correctness fix.

## Caveats

- n=1 per variant, one problem. Strong signal, not a measurement.
- The clean setup (deps pre-installed) made running the gate easy, so "ran the baseline" no
  longer separates the instructed variants — which usefully pushed the differentiation up to
  the harder question of fix-verification.
- The misnamed-fixture trap that v5-minimal caught last run went unnoticed by all this time
  — stripping git history changed the investigation path (agents anchored on file mtime
  instead of digging into `conftest.py`).
