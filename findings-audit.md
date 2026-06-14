# Field audit: what a week of real Fable 5 sessions taught the operating instructions

A companion to [findings.md](findings.md). That file is a *controlled* A/B/C test — does
attaching [Fable5.md](Fable5.md) change a capable model's output? This is the opposite lens: an
*observational* audit of every real session Fable 5 actually drove over one intensive week, mined
for the failure modes, recoveries, and habits the operating doc should encode — and the edits that
resulted.

## Summary

The doc held up well on the dimensions it already covers. Its spine — confirmed-vs-inferred,
baseline-then-delta, "a green suite is necessary, not sufficient," "name what speaks the old
contract," "stop for a yes before outward actions" — was repeatedly vindicated: nearly every real
bug the model shipped was a textbook instance of a path the green suite never exercised, and the
strongest sessions (reproducing a bug against a live database before fixing it, stashing to confirm a
baseline, writing bidirectional regression tests) are the doc working as designed.

The gaps the audit found were of two kinds, and only one is fixable with words. **Compliance gaps** —
the doc already says it and the model lapsed anyway (it launched a dozen review agents on a ~250-line
change; it used a blanket `git add`; it began work after an explicit "not yet"). **Coverage gaps** —
the doc was genuinely silent. The audit surfaced eleven evidence-backed themes; all eleven survived an
adversarial verification pass and were folded into the doc as **three new bullets and eight sharpened
ones**, weighted toward the coverage gaps and toward sharpening, not adding.

## The corpus

- **31 sessions** where Fable 5 was the *driving* loop — not merely present in pasted text — over one
  intensive week.
- **~11,100 model turns; ~112 MB** of raw transcript.
- **Five private repositories** of differing shape: a couple of production web apps, a TypeScript
  monorepo with smart contracts, a docs/education site, a data-analysis tool, and one non-code
  (legal-drafting) task — so the lessons aren't specific to one stack.
- **Work types:** building multi-PR features from a written plan, triaging automated-reviewer
  comments, security and invariant audits, remote deploys, and cross-session continuations after
  context compaction.

## Method

1. **Compress.** Parse each transcript; keep human turns verbatim, the model's reasoning and replies,
   tool intents, and tool *errors*; drop bulky successful tool output and binary blobs. 112 MB → ~4 MB
   of readable conversation.
2. **Mine.** One agent per session extracts evidence — failure modes, user corrections, environment
   gotchas, good habits — each finding pinned to a verbatim quote and a turn citation (310 raw
   findings).
3. **Synthesize.** Cluster into themes; rank by frequency × severity; map each to the existing doc and
   distinguish compliance from coverage.
4. **Verify adversarially.** Test each proposed change: grounded in real cited evidence? genuinely
   novel against the current doc? generalizable beyond a one-off? — keep / refine / cut.
5. **Cross-check.** Run the whole thing a second, independent way — a hand read of the largest sessions
   plus a quantitative pass over every tool error — and reconcile.

The two passes converged on the same themes with no divergence in substance; the verification stage
also caught and removed an unsupported example from its own synthesis draft.

## What the audit added

| Theme | ~Sessions | Edit | Representative evidence (generalized) |
| --- | --- | --- | --- |
| A deploy's 200 proves a process is up, not that the **new** code serves | 8 | sharpen *Run the real thing* | a health check passed against the old container mid-swap |
| A green suite says nothing about a **parallel path, a preview, or real data** | 9 | sharpen *re-run the gate* | analysis endpoints 500'd on real records; a money view rendered values off by a fixed scaling factor — all behind a green suite |
| An **automated reviewer** is a hypothesis, with a tool hierarchy | 9 | sharpen *finding is a hypothesis* | a bot asserted a wrong library error-string that would have shipped a broken check |
| **External contracts drift** under stable code | 6 | sharpen *Ground recommendations* | code built against a retired credential format after the upstream API moved to signed tokens; a recommended hardware SKU had been discontinued |
| Write the **continuation handoff to a file** before a context boundary | 14 | sharpen *close with the state* | multi-hour, multi-compaction work carried by one self-contained handoff doc |
| A **hold persists**; a workflow launch is itself the irreversible action | 5 | sharpen *stop for a yes* | a multi-agent workflow fired after an explicit "not yet" |
| Match effort to blast radius — **including the review machinery** | 3 | sharpen *blast radius* | a dozen review agents fanned out on a ~250-line change |
| With **stacked PRs**, confirm the merge reached main | 4 | **new bullet** | a merged child left its later work off main until the base branch was deleted |
| **Signals lie both ways** — read the real output, not the exit code | 15 | **new bullet** | a deploy CLI exited non-zero on a successful run |
| **Re-read** a file when the tree changes under you | 27 | **new bullet** | edits rejected as "modified since read" after a branch switch or parallel commit |
| Don't lead confident, or mark done, before the gate runs | 6 | sharpen *Before you send* | a confident "nothing was lost" retracted under a second look |

## Highest-frequency friction (raw tool-error categories, all sessions)

Pure latency, mostly avoidable: read-before-edit invalidated by a branch switch / parallel commit /
linter / compaction (~27 of 31 sessions) · test-runner failures (53) · git (48) · shell/CLI quoting
and exit-code surprises (45) · path-not-found (27) · remote-deploy/build (26). These drove the three
new bullets and the portability decision below.

## Decisions and limitations

- **Observational, not controlled.** This measures what *recurred* across real work, not what the doc
  *caused*. The causal question is findings.md's; treat the two as complements.
- **Kept portable on purpose.** The biggest single error category was shell/platform-specific
  (Windows/PowerShell), but the doc is deliberately platform-agnostic — so those lessons went in as
  *one* portable bullet ("a signal can lie in both directions") with the platform specifics confined
  to a parenthetical, rather than a new OS-specific section. Per-environment facts belong in project
  memory, not the portable instruction set.
- **One operator, one platform, one week.** The environment-shaped findings may not transfer.
- **Model-assisted mining, hand-checked.** The largest sessions were read end-to-end and every tool
  error counted by script; the smaller sessions rest on the automated pass, not a full manual read of
  all 112 MB.
- **Generalized for a public repo.** Project names, dollar figures, third-party identifiers, and the
  legal matter are abstracted here on purpose; the underlying evidence is cited to specific sessions
  and turns in private notes.

## Relationship to findings.md

`findings.md` asks *do these instructions change a capable model's output, and are they worth the
cost?* This asks *given a week of real output, what is the doc still missing?* The first is an
experiment; the second is a retrospective. Together they point the same way: keep the discipline the
experiment validated, and close the coverage gaps the retrospective found — while resisting the urge
to legislate the compliance gaps with more words.
