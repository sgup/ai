# Bowling Game × Operating-Instructions A/B

Does the *version* of the "Fable5" operating instructions change what a single
subagent one-shots for an identical creative build task?

## The task (identical for every variant)

> create a full featured, realistic bowling game, with proper scoring, bowling
> balls, animations, etc. It should be easy to play with a mouse. it should be 3d
> and in browser. don't ask any questions, just one-shot build it.

## Variants

| Variant  | Operating instructions injected | Tag → commit | What that version captures |
|----------|----------------------------------|--------------|----------------------------|
| baseline | none (control)                   | —            | vanilla subagent, no operating instructions |
| v1       | `Fable5.md` @ v1                  | e85e2d6      | instructional forcing-functions; 7 gap-clauses restored |
| v2       | `Fable5.md` @ v2                  | 2d4dc47      | rewrite to match observed Fable 5 behavior |
| v3       | `Fable5.md` @ v3                  | 945ba77      | + execution, safety & honesty rules from the system card |
| v4       | `Fable5.md` @ v4                  | 9e087b3      | + quality-floor & design-interrogation rules |

## Method

- One subagent run per variant (n=1), driven from a Claude Code session.
- **Model held constant:** Opus 4.8 (`claude-opus-4-8`), inherited from the driving
  session — the only variable is the instructions.
- **Injection:** each tagged subagent self-loads its version as STEP 0 via
  `git -C ~/Code/ai show <tag>:Fable5.md` and is told to adopt it as its operating
  instructions for the task. Baseline gets the identical task wrapper with no preamble.
  The task wrapper (output location + the verbatim prompt + a closing "list files /
  summarize" line) is byte-identical across all five.
- Each run writes its game to `<variant>/code/`; the full subagent transcript is
  saved to `<variant>/session-log.jsonl`, and its final message to `<variant>/final-report.md`.

## Caveats (read before drawing any conclusion)

- **n=1 per variant.** LLM output varies run-to-run; treat differences as anecdotes,
  not measurements.
- **Unverified code.** Subagents run in a sandbox that cannot render or play a 3D
  browser game. Nothing here has been confirmed to actually run.
- **Injection ≠ production placement.** In real use these instructions live in the
  system prompt; here they are injected via the user turn. Consistent across variants,
  but an approximation.
- The "don't ask any questions, just one-shot build it" clause is deliberately in
  tension with some versions (e.g. v4's design-interrogation rules). That tension is
  part of what's being observed.

Run date: 2026-06-15
