# Field test: do these operating instructions change a coding agent's output?

A controlled test of [Fable5.md](Fable5.md) — measuring whether attaching an
operating-instructions document to a frontier coding model actually changes what
it produces, and where that change is worth its cost.

## Summary

Attaching the instructions did not make a capable model more *correct* on
ordinary, well-scoped work. A strong model sitting on a decent project config
already establishes a baseline, re-runs its tests, separates pre-existing
failures from new ones, commits only what it touched, and reports honestly — on
its own. The instructions earned their keep in two specific places: a consistent
**auditability layer** (every change closes with what was verified, what is
assumed, and how to roll it back), and a **reliability margin on subtle,
side-effect-prone changes**, where the habit of checking the non-obvious was the
difference between a passing test suite and correct code.

## What was tested

Three conditions, identical tasks, only the instructions varied:

- **A — none.** The model with no operating doc. It still inherits the
  repository's own project config and memory.
- **B — previous version.** Earlier instructions built around explicit artifacts
  (inline `[verified]`/`[assumed]` tags, a fixed four-line honesty block).
- **C — current version.** The rewrite, which instructs the same discipline in
  the model's own grain — prose honesty with evidence citations — rather than
  mandated tags.

Each condition ran twice per task to separate signal from run-to-run variance.

## How

Tasks ran against a real production TypeScript monorepo, not toy problems.
Execution tasks ran in isolated git worktrees with a real test gate; pushes were
routed to a throwaway sink so nothing touched the real remote. Results were
checked objectively wherever possible — re-running the full test suite, probing
the committed code's actual behavior — and by a blind panel where judgment was
needed, with graders never told which condition produced an answer.

The no-instructions condition was leak-checked five ways — empty global config,
clean project config, a doc-free prompt, no document reads mid-run, and direct
introspection of a fresh agent under the same conditions — to confirm that
"no instructions" really meant none.

## Results

| Task | A — none | B — old | C — new | Takeaway |
| --- | --- | --- | --- | --- |
| Open-ended bug audit (true bugs found) | 10 | 11 | 10 | Tie — within-run variance exceeded the gap |
| Architecture recommendation (blind panel, /5) | 4.83 | 4.67 | 4.17 | The no-doc answer scored highest |
| Routine bug fix + test + commit | correct | correct | correct | Tie on outcome; identical discipline |
| Fix that hid a silent regression | **1 of 2** | **2 of 2** | **2 of 2** | Instructions reliably avoided the trap |

In the first three task types every condition produced functionally equivalent
results. Unaided, the model already established a baseline, re-ran the full
suite, separated pre-existing failures from new ones, staged only the files it
changed, and never shipped a broken suite.

The fourth task was built to reward one specific habit: thinking through the side
of a change you are not looking at. The request contradicted an existing test,
and the obvious implementation also introduced a second, silent, over-broad match
that no existing test covered — so the suite stayed green even when the code was
wrong. Every condition handled the visible conflict. But on the hidden
over-match the no-doc runs split — one correct, one shipped the bug — while both
instruction conditions caught it every time, because the instructions push the
model to reason about what else a change touches.

## What the instructions reliably change

- **Order of work.** With instructions, the model captures its baseline before
  editing rather than reconstructing it afterward.
- **Auditability.** Every change closes with a clear separation of what was
  verified, what was assumed, what only a human can confirm, and how to undo it.
- **A margin on hard changes.** On a task that rewarded checking the non-obvious,
  the instructions turned an inconsistent habit into a reliable one.

The cost is real: roughly 0–50% more output and 25–70% more wall-clock time,
depending on the task.

## Old version vs new

The two versions performed equivalently on output quality. The rewrite's
advantage is accuracy: it describes how the model actually externalizes its
reasoning — in prose, with evidence citations — instead of prescribing artifacts
it produced only because it was told to. Same results, instructions that match
reality.

## Follow-up — does it change the actual patch?

The field test above scored *approach* and *outcome*. A second round asked a
sharper question: when each variant produces a real patch, judged by hidden tests
it never sees, does the patch itself differ? Four variants — none, the previous
version, the current version, and an independently-authored alternative — each
fixed the same bug in an isolated checkout, scored by a gold suite restored after
the agent finished (so no patch could weaken a test to pass). Everything ran on a
flat-rate subscription, at no per-token cost.

Three bugs, increasing in nastiness:

- **A localized logic bug** whose obvious fix regresses an unrelated test. **All
  four fixed it cleanly** — none took the bait.
- **A double-charge under retry and concurrency.** The minimal correct fix
  satisfies the literal contract but leaves duplicate bookkeeping rows under a
  concurrent retry storm. **The uninstructed agent stopped at the literal
  contract; all three instructed variants serialized the race** — the first
  score-visible split.
- **Stale permissions after a role change,** behind a cache with two *hidden*
  parallel read paths. **All four traced both paths, invalidated correctly, and
  avoided over-flushing** — the under-scoped and overreach traps caught nobody.
  The whole split came down to one deterministic concurrency gate: after an update
  returns, can a still-in-flight read repopulate a stale value? **Only the current
  version made its compute-and-write atomic against the update; the other three
  repopulated the stale permission** — the same result on five of five runs.

The pattern from the field test held and sharpened. On the *named* bug and every
non-concurrency trap, a capable model — uninstructed included — lands a correct,
non-regressing, multi-path-aware fix; eight of eight on the obvious correctness.
The separation is **entirely on concurrency depth**, and it only surfaces when the
harness is built to *trigger* the failure: a 400-round stress probe of the
permissions race found zero failures for every variant, while a deterministic,
event-coordinated gate found the hole every time. Across the round the instructed
variants — and the current version most consistently — carried the most defensive
depth: it alone closed *both* concurrency races, and, in a separate browser-game
task, alone built and tested against a real-environment failure (a page that only
breaks when opened as a file, not over a server) that the others shipped past. The
independently-authored alternative matched the previous version's useful behavior
but never reached that depth.

(Full study, fixtures, and per-variant patches: `experiments/swe-bench-mini/`.)

## Limitations

- A single codebase, with an already-strong project configuration that supplied
  much of the baseline discipline. On a bare repository the instructions would
  likely carry more weight.
- Small sample — two runs per condition. The headline trap result (1 of 2 vs
  2 of 2) shows the instructions make a habit *reliable*, not that an unaided
  model always fails it.
- Judgment-based grading used a blind panel, and one verification step relied on
  a model truthfully reporting its own context, corroborated by four independent
  on-disk checks.
- The patch-and-test follow-up is one run per bug across three bugs; its
  separation rode entirely on concurrency gates the harness was purpose-built to
  trigger, and would be invisible to a less adversarial test.

## Recommendation

Use the instructions where they pay for themselves: high-stakes or subtle
changes, and anywhere an auditable trail matters. Skip them for trivial,
well-scoped work, where a capable model and a good project config already do the
job and the overhead buys nothing.
