# SWE-mini — real patch-and-test, instruction-variant comparison

Each instruction variant gets a fresh, isolated checkout + a bug **report** (symptom
only), produces an **actual patch**, scored by **gold tests** — not self-narration. Run
through subscription subagents → **no marginal API dollars**. Variants: `none`, `v4`,
`v5`, `gpt55` (the GPT-5.5-recommended draft). Canonical tests/oracle restored before
scoring, so no patch can game a test. Patches in `patches/`.

---

## Instance 1 — `arrow` `humanize()`  (localized logic bug)
Trap: the obvious reorder regresses `test_month`. **4/4 resolved + clean.** No separation.

## Instance 2 — billing idempotency  (concurrency + state)
Per-attempt processor key → retries/concurrency double-charge. Gold `G1` retry, `G4`
concurrent (one remote charge), **`G6` concurrent (one local row)**; guards `G2`/`G3`/`G5`.

| variant | G1 | G4 | **G6** | G2 G3 G5 | verdict |
|---|:--:|:--:|:--:|:--:|:--:|
| **none** | ✅ | ✅ | **❌** | ✅ | resolved, **not clean** |
| v4 / v5 / gpt55 | ✅ | ✅ | ✅ | ✅ | clean |

**3 clean / 1 fail.** `none`'s lockless boundary fix leaves duplicate local rows; the
three instructed variants serialized the find-then-create race. Gateable because the
fixture's race window is wide (an injected `sleep`).

## Instance 3 — stale permissions  (multi-path cache invalidation + concurrency)
Per-user cache with **two hidden parallel entrypoints** (`api_auth`, `worker_auth`), two
role-mutating functions, a legacy session shape, an overbroad-flush trap, and a
**deterministic concurrency gate**. Gold: `F1` main · `R1` API · `R2` worker · `R3`
role-perm-change · **`R4` no stale repopulation after update returns** (FAIL_TO_PASS);
`R5` no-overbroad · `R6` legacy (guards).

| variant | F1 | R1 | R2 | R3 | **R4** | R5 | R6 | verdict |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| none | ✅ | ✅ | ✅ | ✅ | **❌** | ✅ | ✅ | 6/7 |
| v4 | ✅ | ✅ | ✅ | ✅ | **❌** | ✅ | ✅ | 6/7 |
| **v5** | ✅ | ✅ | ✅ | ✅ | **✅** | ✅ | ✅ | **7/7 clean** |
| gpt55 | ✅ | ✅ | ✅ | ✅ | **❌** | ✅ | ✅ | 6/7 |

All four nailed the hard multi-path fix (traced both hidden entrypoints, invalidated
both mutators, no overbroad `cache.clear()`, preserved legacy) — the under-scoped and
overreach traps caught nobody. **The split is `R4`: v5 alone made compute-and-set atomic
w.r.t. the update, so it's the only one that doesn't repopulate a stale permission under
the forced interleaving.** `R4` is **property-based** (any atomic compute-set — lock,
generation/CAS, re-invalidate — passes; not tied to v5's lock) and **deterministic**
(event-coordinated seam in `cache.set`, the protected oracle; **5/5 stable** per variant),
not a stress loop. none/v4/gpt55's stress-probe (0/400) hid the hole; the deterministic
gate exposes it.

---

## Combined takeaway (3 instances × 4 variants + the bowling task)

- **Two score-visible separations, both on concurrency robustness — and once the harness
  makes a property *deterministically gateable*, v5 separates on exactly the dimension it
  is designed to push.** Billing `G6`: instructed variants > `none`. Permissions `R4`:
  **v5 > none/v4/gpt55** — v5 is the **only variant to close *both* races**.
- **On the "obvious" correctness — the named bug plus every non-concurrency trap
  (regression, multi-path, legacy, overbroad-flush) — all four tie at a very high floor**,
  uninstructed `none` included. The separation is *entirely* on concurrency depth, and
  only surfaces when the fixture exposes it.
- **v5's edge is verification rigor + defensive/concurrency depth.** Three data points
  now: bowling `file://` (real-environment verification — v5 alone), billing `G6`
  (instructed > none), permissions `R4` (v5 alone). Each shows up only when the harness
  can trigger or observe the failure.
- **gpt55 matches v4** (both fail `R4`); it never reaches v5's depth and never beats it.

## Design lesson (validated)
A robustness property only *gates* if its violation is **triggerable** and the test is
**deterministic**. The winning pattern: put an event-seam in the **protected oracle**
(`cache.set`, which agents can't modify) so it survives any fix shape, then coordinate the
worst-case interleaving with events (not a stress loop). That converted v5's code-level
concurrency hardening — invisible to a 400-round probe — into a stable, reproducible gate
that the other variants fail 5/5.

## Caveats
- n=1 per instance; directional signal, not a measurement.
- Honest net: *negative* for "instructions raise pass rate on clean fix tasks"; *positive*
  for "instructions add concurrency/verification depth that becomes a win once the harness
  exposes it — and v5 has the most of it."
