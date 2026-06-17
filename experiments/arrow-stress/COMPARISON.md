# arrow humanize() stress test — comparison

Five instruction variants, one diagnostic problem on **real code** (live bug in
`arrow` at HEAD `2224255`): humanize() reports "a month" for 15–45-day differences.
Approach-only. Clean-slate session. Full answers in `results/<variant>.md`; hidden
scoring rubric in `GROUND-TRUTH.md`.

## Headline

**On a genuinely hard problem, all five nailed the core diagnosis** — every one
reproduced by running, discovered the *whole 15–45-day band collapses* (the weeks
bucket is dead, not just the one reported date), traced it to the `>14` bump + the
month-branch-before-weeks ordering with value-level instrumentation, found the
fix→revert history via `git log`, and gave a regression-aware fix plan. The base model
is very strong; the hard, well-specified problem pulled rigor out of even `none`.

So the differentiation is no longer "did they catch it" — it's **depth and specific
judgment moves**, and that's where the instructions show up.

## Differentiators (core diagnosis was universal — omitted)

| Move | none | v4 | v5-min | v5-comp | v5-bal |
|---|:--:|:--:|:--:|:--:|:--:|
| confirmed/inferred labels + "most likely wrong" | ✗ | ✓ | ✓ | ✓ | ✓ |
| Disproved the "Jan 9 date" red herring with a **multi-date matrix** | ✗ | ✗ | ~ | ✓✓ | ✓ |
| **Actually ran the real pytest gate** (installed deps, got a baseline) | ✗ | ✗ | ✓ (25) | ✓ (50/225) | ✗ |
| Caught the **misnamed test fixture** (`time_2013_01_01` actually uses `utcnow()`) | ✗ | ✗ | ✓✓ | ✗ | ✗ |
| Found the same `>14` bug **one tier up** (45d→"month" vs 46d→"2 months") | ~ | ✗ | ✗ | ✓ | ✓ |
| Deepest reasoning on **why the fix was reverted** (the 29/30-day boundary) | ~ | ~ | ~ | ✓ | ✓✓ |
| Length | long | long | longest | long | medium |

## What each variant uniquely surfaced

- **none:** a clean *structural dead-code proof* that the weeks branch is unreachable; found the revert via `git log -L`. No epistemic labels, no "most likely wrong." Substantively rigorous, just unlabeled.
- **v4:** the discipline layer — confirmed/inferred throughout, "stakes read," named the alternative it rejected (reorder-only leaves the phantom-month bug live), "the claim I'd most expect to be wrong."
- **v5-minimal:** pushed by *verify-in-the-real-environment*, it **installed the test deps and ran the real suite** (baseline 25 passed) — and in doing so caught a genuine **name-vs-behavior trap in the test infra**: the `time_2013_01_01` fixture actually binds `self.now = utcnow()`, so the calendar-sensitive humanize tests depend on the wall-clock run date. No other variant found this.
- **v5-comprehensive:** most rigorous *cause-elimination* — an explicit "kill the plausible-but-wrong cause" step that disproved the date theory across 5 start dates with evidence; ran the full gate (225 passed); the most exhaustive regression matrix; flagged the `--cov-fail-under=99` gate it couldn't run honestly. Longest.
- **v5-balanced:** deepest *minefield* reasoning — it reasoned out the **specific** regression a naive fix causes (29/30-day diffs flip to "4 weeks" where "a month" is more natural) as the likely reason #1242 was reverted, and verified the real-month discriminator across month lengths. And — consistent with *match-cost-of-verification + report-the-blocker* — it **declined to mutate the sandbox** by installing pytest, flagging the missing gate as a blocker to report rather than papering over it with ad-hoc scripts. Most concise.

## The most interesting finding

The instructions don't add rigor uniformly — **specific clauses produce specific, sometimes-divergent moves**, and on a hard problem those are the whole story:

- *Verify-in-the-real-environment* drove **min** and **comp** to install deps and run the real suite — which uncovered extra real findings (the fixture trap, the coverage gate).
- *Match-cost-of-verification + report-the-blocker* drove **bal** to do the opposite — **not** install packages (an env mutation), flag the blocker, and use lighter cross-checks.

Both are defensible. "Install test deps in a sandbox to get the real gate" vs "report the env blocker and don't mutate it" is a genuine judgment fork the clauses pull on differently. That's a finding about the *clauses*, not just the agents.

## Implication for v5 (combined with the toy)

- The **core clauses** (reproduce-by-the-real-path, verify-in-the-real-environment) clearly earn their place — they drove running the real gate and disproving the date red herring.
- The **cost-of-verification counterweight** earns its place — it produced proportionate verification and the deepest where-it-counts reasoning, and kept `balanced` concise.
- **Comprehensive's breadth paid off more here than on the toy** — a genuine minefield rewards an exhaustive regression matrix. But its *task-irrelevant* clauses (handoff-to-file, workflow-cost) still sat idle.
- Net: final v5 ≈ **balanced** (core + counterweight) **plus** the one genuinely valuable thing comprehensive added — an explicit *enumerate-and-confirm-every-parallel-case / regression-completeness* clause — while cutting the clauses that never fire on a focused bug.

## Caveats

- n=1 per variant, one problem. Strong signal, not a measurement.
- The "did they run the real gate" split (min/comp yes; none/v4/bal no) is partly luck of how each weighed installing sandbox deps — a re-run could flip it.
- All five had the revert commit visible in `git log`, which handed everyone the "this is a minefield" signal; a cleaner test would hide the history.
