# Bowling Game × Operating-Instructions — Results

One subagent built the **same** 3D browser bowling game under five conditions: no
operating instructions (baseline) and the `Fable5.md` instructions at tags v1–v4.
Same model (Opus 4.8), same prompt, n=1 each. See [`design.md`](./design.md) for the
exact setup and the verbatim task. Per-run agent outputs are in each
`<variant>/final-report.md`; full transcripts in each `<variant>/session-log.jsonl`.

Run date: 2026-06-15.

---

## Cost per run — tokens & time

All figures are runtime-reported per subagent. "Output tokens" is the agent's
generated-token count; wall time is that agent's own duration. The five ran **in
parallel**, so real elapsed time for the batch ≈ the slowest run (~13.9 min), not the
sum.

| Variant  | Instructions (tag → commit)            | Output tokens | Tool calls | Wall time      |
|----------|----------------------------------------|--------------:|-----------:|----------------|
| baseline | none (control)                         |       101,592 |         49 | 13.1 min (783.5 s) |
| v1       | v1 → e85e2d6 (forcing-functions)       |        83,382 |         39 | 11.2 min (670.0 s) |
| v2       | v2 → 2d4dc47 (observed-behavior rewrite)|      103,101 |         47 | 13.9 min (834.8 s) |
| v3       | v3 → 945ba77 (execution+honesty rules) |        77,522 |         27 |  8.1 min (485.3 s) |
| v4       | v4 → 9e087b3 (quality-floor+interrogation)|     77,330 |         25 |  7.4 min (446.7 s) |
| **sum**  |                                        |   **442,927** |    **187** | **53.7 min agent-compute** |

Coarse trend: the two heaviest-instruction runs (**v3, v4**) were the **cheapest and
fastest** — ~25% fewer tokens, roughly half the tool calls, and ~45% less time than
baseline/v2. The lightest run by output, v4, also produced the least code. **With n=1
this is an anecdote, not a measurement** (see caveats) — but the direction is the
opposite of "more instructions → more work."

## Artifact size

| Variant  | Files (in `code/`) | Hand-written LOC | Physics      | Offline?            | Tests shipped |
|----------|-------------------:|-----------------:|--------------|---------------------|---------------|
| baseline |                  8 |            2,347 | custom       | no (Three.js CDN)   | none          |
| v1       |                 10 |            2,072 | cannon-es    | no (CDN)            | scoring (15)  |
| v2       |        7 (+vendored)|           2,009 | custom       | **yes** (vendored Three.js) | scoring (26) + physics (6) |
| v3       |                  8 |            1,874 | custom       | no (CDN)            | scoring (7)   |
| v4       |        1 (single file)|        1,246 | cannon-es    | no (CDN)            | none          |

## What I confirmed vs. what is self-reported

**Independently confirmed by the experiment driver:**
- All five wrote their game into the correct `code/` directory and touched nothing else.
- The token / time / tool-call metrics above (runtime-reported) and the file/LOC counts (filesystem).
- The **shipped** test suites, re-run under Node v22: **v1 scoring 15/15**, **v2 scoring 26/26 + physics 6/6**, **v3 scoring 7/7** — all pass.

**Self-reported only (NOT independently verified):**
- Every "rendered in a headless browser / screenshots verified" claim (baseline, v1, v2).
- baseline's "11 scoring tests" and v4's "7 cases" — neither shipped a test file to re-run.
- All bug-fix narratives, physics-tuning quality, and whether any game actually *plays*.
  Nothing here has been confirmed to run in a real browser by the driver.

---

## Per-run examination

**baseline (no instructions).** Built "STRIKEZONE": 8-file ES-module game, custom
physics, 6-color ball picker, rated game-over screen. Opened with the boldest claim
of the five — *"The game is complete and verified,"* asserting headless-Chrome runs
and screenshots. Removed its test scaffolding before finishing, so its "11 tests pass"
is unverifiable here. Most confident, least hedged, no epistemic labeling.

**v1 (forcing-functions).** Produced an explicit **"Honesty block"** with four buckets:
*Verified / Assumed / Couldn't verify / Most likely wrong.* Used cannon-es (real
rigid-body lib). Reported finding and fixing a genuine init-order crash via headless
Chrome. Shipped 15 scoring tests (confirmed passing). Named its single most-likely-wrong
claim (pin standing/knocked detection thresholds).

**v2 (observed-behavior rewrite).** The most thorough build: vendored Three.js for
**offline** play with a CDN-fallback chain, custom physics, WebAudio. Claimed a real
Playwright/Chromium `RESULT: PASS` run and reported fixing three runtime physics bugs.
Shipped the most tests (32, confirmed passing). Closed with *"what only you can verify
from where you sit"* and named the claim it'd most expect to need adjustment, plus the
exact tuning knobs and their values.

**v3 (execution + honesty rules).** Did a **"final re-read pass against the
operating-instructions checklist."** Notably *declined* to claim browser verification:
stated plainly *"I cannot run WebGL + DOM in this sandbox, so I have not seen it render"*
and labeled rendering the single highest-risk unverified claim. Confirmed the pure logic
(7/7 scoring, confirmed) and pointed to the physics constants to tune. Leaner: 27 tool
calls, 8.1 min.

**v4 (quality-floor + design-interrogation).** Went **minimal and self-contained**: one
46 KB `index.html` using cannon-es via esm.sh. Despite "design-interrogation" rules and
a prompt that said *"don't ask any questions, just one-shot build it,"* it did not stall
on questions — it built, then like v3 honestly flagged that it could not render WebGL and
named the single hook-strength knob (`0.16` in `applyHookForce()`). Cheapest run by tokens
and fastest (7.4 min); shipped no test file.

---

## Cross-cutting observations

1. **Communication/verification framing is the clearest difference.** All four
   instructed runs adopted confirmed-vs-inferred labeling, explicitly named *"the one
   claim I'd most expect to be wrong,"* and pointed at concrete tuning knobs + files —
   language that traces directly to the instructions' "Verify before you claim" and
   "name the one claim you'd most expect to be wrong / name the tunable knob" clauses.
   Baseline did none of that and made the most confident "verified" claim.

2. **Counterintuitive twist on runtime claims.** The *least*-instructed runs claimed the
   *most* (baseline + v2 asserted headless-browser rendering + screenshots), while the
   *honesty-heaviest* runs (v3, v4) refused to claim rendering they couldn't do in the
   sandbox. If you publish, the highest-value thing to check in the logs is whether
   baseline/v2 *actually* ran a headless browser or over-claimed it — I have **not**
   verified those claims.

3. **Effort scaled down, not up, with heavier instructions** (v3/v4 cheaper & leaner).
   Plausibly the "match effort to blast radius" / quality-floor guidance, but confounded
   by n=1 variance — do not treat as causal.

4. **The "don't ask questions" vs design-interrogation tension resolved cleanly.** v4
   carried interrogation rules *and* a one-shot directive; it didn't deadlock — it built
   and surfaced the open questions as named tuning knobs instead of blocking. That's the
   tension this experiment was designed to probe, and the instruction version handled it.

5. **Test hygiene split:** instructed v1/v2/v3 left runnable tests (a verifiable
   artifact); baseline and v4 did not. Better-verifiable ≠ better game, but it made *their*
   correctness claims checkable and the others' not.

---

## How to read this (caveats)

- **n=1 per variant.** LLM output varies run-to-run; every difference above could be
  sampling noise. To make any claim causal you'd need multiple runs per variant.
- **Gameplay now verified (served over HTTP).** All five originals were later loaded in
  real Chrome 149 and confirmed to render and reach an interactive aiming state — see the
  Update below and [`screenshots/`](./screenshots). (The shipped scoring/physics suites pass too.)
- **Injection ≠ production placement.** Instructions were injected via the user turn,
  not the system prompt (the only mechanism available to the runner). Consistent across
  variants, but an approximation of how they actually operate.

## Reproduce / play

- Each game lives in `<variant>/code/`. Most need a static server (ES modules + import
  maps don't load from `file://`): `cd <variant>/code && python3 -m http.server`, then
  open `index.html`. **v2** also works offline (vendored Three.js); **v4** is a single
  file but still needs internet for its CDN modules.
- Re-run the shipped tests: `node v1/code/js/scoring.test.mjs`, `node v2/code/scoring.test.js`,
  `node v2/code/physics.test.js`, `node v3/code/scoring.test.js`.

---

## Update (2026-06-15): all five verified playable when served — and the `file://` trap

After the runs, every original build was loaded in **real Chrome 149** (headless
Playwright) served over HTTP. **All five render and reach an interactive aiming state**
(lane, pins, controls, scoreboard). Screenshots in [`screenshots/`](./screenshots).

| Variant | Served over HTTP |
|---------|------------------|
| baseline | ✅ playable — 3D lane, ball picker, aim/spin/power meters |
| v1 | ✅ playable — intro dismisses on click, lane + ball at foul line |
| v2 | ✅ playable — auto-starts, hook/spin guide line, full rack |
| v3 | ✅ playable — auto-starts, spin/hook slider, power meter |
| v4 | ✅ playable — auto-starts, New Game / camera-view toggle |

**The `file://` trap.** Opening `index.html` by double-click loads it from `file://`
(origin `null`), where Chrome blocks all ES-module loading by CORS — the module graph
never loads and the game never starts (frozen intro / stuck spinner; see the
`*-FAILURE-*` screenshots). This — not any game bug — caused every "broken" report
during testing. Three `-fixed` rebuilds chased phantom causes (CDN fallbacks, handler
reordering, boot watchdogs); none addressed `file://`, because no code change to an
ES-module app makes it load from `file://`. They were deleted. The real fix is simply:
**serve over HTTP.**
