# Instruction-variant × approach — comparison

Five agents, one per instruction variant, each given the same buggy pricing codebase
(`src/`, `tests/`, `README.md`) and the same problem set (`PROBLEMS.md`: P1 a coupon
under-charge report, P2 a ship review), asked to describe its **approach** only (no
implementation). Run from a clean-slate session (`~/Code/ai`, no project CLAUDE.md /
memory). Model held constant. Full answers in `results/<variant>.md`.

## Headline

**Bug-catching was equivalent across all five — even the no-instructions baseline found
every planted bug.** What the instructions changed is *verification discipline and
honesty*, and that difference is large.

All five caught: the missing 50% coupon cap (P1 root), the divergent `checkout.py` that
**drops tax** (the parallel-path money leak), the `is_valid_cart` `>=`-and-any/all bug,
`parse_price`'s silent-zero, the vacuous green tests, and the README's unverifiable
"validated upstream" claim.

## Where they diverged

| Behavior | none | v4 | v5-min | v5-comp | v5-bal |
|---|:--:|:--:|:--:|:--:|:--:|
| Actually **ran the code** to ground claims (vs. proposed to) | ✗ | ✓ | ✓ | ✓ | ✓ |
| **Confirmed/inferred** labeling | ✗ | ✓ | ✓ | ✓ | ✓ |
| Captured test **baseline** + flagged **pytest-not-installed** env gap | ✗ | ✓ | ✓ | ✓ | ✓ |
| Named "the one claim I'd **most expect to be wrong**" | ✗ | ✓ | ✓ | ✓ | ✓ |
| Gated **deploy/commit** behind an explicit go | ~ | ✓ | ✓ | ✓ | ✓ |
| Reproduce the **exact order/path first**; coupon may be a red herring for the tax bug | ~ | ~ | ✓ | ✓✓ | ✓ |
| Noticed `parse_price` is **dead code** (grep) | ✗ | ✗ | ✗ | ✓ | ✓ |
| **Justified the verification cost** (cheap local run as proportionate proxy) | ✗ | ✗ | ✗ | ✗ | ✓ |
| Length (lines) | 180 | 83 | 90 | 94 | **66** |

## Read per variant

- **none (clean Opus):** genuinely strong — found all the bugs by *reading*. But it only
  *proposed* to run the code, never did; no confirmed/inferred tags; missed the
  pytest-not-installed env gap; no "most likely wrong." Strong instincts, no grounding or
  self-audit scaffold. Also the longest (it reasons in prose instead of running).
- **v4:** adds the full discipline layer — actually executed (`apply_coupon(100,80)→20.0`,
  `order_total vs charge_amount = 54.0 vs 50.0`), confirmed/inferred throughout, baseline +
  env-gap, named the fix-location fork, "most likely wrong = fixing only `apply_coupon`
  leaves the tax divergence," explicit no-commit/push. The big jump is here.
- **v5-minimal (v4 + 2 core clauses):** the **reproduce-by-the-real-path** clause visibly
  fired — strongest framing of "which surface and coupon % did the customer actually use,
  before declaring the cap is the cause," plus "the path it ships into, not the happy one I
  tooled up." A real, on-point gain over v4 for a bug-report task.
- **v5-comprehensive (v4 + everything):** most thorough — uniquely flagged `parse_price` as
  *dead code*, most explicit that "coupon" may be a **red herring** for the tax-omission
  bug, named the most forks. But the **longest**, and several of its clauses
  (handoff-to-file, workflow-cost, signals-lie) were irrelevant to this task and never
  fired — instruction weight carried for no benefit here.
- **v5-balanced (v4 + core + cost-of-verification counterweight):** matched the rigor, fired
  the reproduce-by-path clause, caught the dead-code via grep — and the **cost-of-verification
  clause produced a distinctive, sensible move**: it explicitly justified using the cheap
  local run as the *proportionate* verification ("the cheap proxy that settles the
  behavioral questions, so I used it instead of guessing"). And it was the **tightest output
  (66 lines)**. The counterweight made it justify its verification, not skip it.

## Implication for v5

- The **two core clauses earn their place** — minimal observably beat v4 on the exact
  diagnostic the bug-report task rewards.
- The **cost-of-verification counterweight earns its place** — it produced proportionate,
  well-justified verification *and* the most concise answer, with no laziness.
- The **kitchen-sink comprehensive did not pay off here** — marginally more thorough, but
  longest, with several clauses idle. Supports the reviewer's "fold/cut, don't pile"
  verdict: v5 should look closer to **balanced** than to **comprehensive**.

## Caveats

- **n=1 per variant, single task.** Differences are real but could shift on another task or
  run; treat as a strong hint, not a measurement.
- The task is a *read-and-diagnose* problem, which is exactly where the reproduce/parallel-
  path/contract-drift clauses are most relevant — a build or migration task might separate
  the variants differently.
- "none" being this strong shows the base model already does the *finding*; the instructions
  mainly add the **grounding, honesty, and gating** scaffold (and, for v5, the
  reproduce-by-path and proportionality instincts).
