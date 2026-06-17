# Variant: v5-balanced

Scope/stakes read: **low-blast, reversible, read-only.** This is an analysis-and-plan task — describe the approach, don't implement. I did run the existing code read-only to ground my claims (no edits to `src/`); per the "match cost of verification to stakes" amendment, running this pure-Python module locally is the cheap proxy that settles the behavioral questions, so I used it instead of guessing from names. A note on the hold: the prompt says plan only and do not implement — so everything below is the plan and the confirming evidence; I have not changed any source file and will not until a fresh go.

Below, **[confirmed]** means I read the line or ran the code; **[inferred]** means I reasoned it and name what would confirm it.

---

## P1 — Coupon under-charge: approach to find, fix, and confirm

### Step 1 — Reproduce the reported symptom by the same path, before touching anything
The report is "applied a coupon, charged less than they should have." The coupon math lives in `apply_coupon` (`src/pricing.py:22`), reached on the web path via `order_total` (`src/pricing.py:35`) and on the mobile path via `charge_amount` (`src/checkout.py:6`). Before theorizing, I reproduce against the README rule that a coupon is **capped at 50%** (`README.md` §Coupon).

I ran this read-only:
- `apply_coupon(100, 80)` → **`20.0`** [confirmed]
- `order_total([{price:100,qty:1}], 80)` → **`21.6`** [confirmed]

Expected under the spec: an 80% coupon must clamp to 50%, so the discounted base should be `50.00`, and `order_total` should be `50 * 1.08 = 54.00`. The code charges `21.60`. That is a real under-charge, reproduced by the reported path (coupon applied). **This is the bug.** [confirmed]

### Step 2 — Locate the cause by reading the call chain, not guessing from names
`apply_coupon` is a literal `amount - amount * percent_off / 100` with **no clamp** to the 0–50 range (`src/pricing.py:24`) [confirmed]. The README cap exists only in the spec, nowhere in code. I grepped call sites: `apply_coupon` is called from exactly two places — `order_total` (`src/pricing.py:38`) and `charge_amount` (`src/checkout.py:9`) — and **neither clamps `percent_off` before passing it** [confirmed via grep]. So the missing cap is the single root cause, and it manifests on **both** entry points.

Root cause (named honestly, ranked): the **missing 50% upper clamp** is the cause of the under-charge. While here I confirmed the same unclamped path also has **no lower clamp**: `apply_coupon(100, -50)` → **`150.0`** [confirmed] — a negative "coupon" over-charges. Same defect (no bounds), opposite direction; I'd fix both bounds together since they're one missing guard, and flag the negative case explicitly rather than launder it as out-of-scope.

### Step 3 — Decide where the fix belongs (name the fork)
Two options, and I'd lead with a recommendation:
- **(A) Clamp inside `apply_coupon`** so every caller is protected by construction. **Recommended** — it's the one chokepoint both entry points already share, so it fixes web and mobile in one place and can't be forgotten at a new call site.
- (B) Clamp in each caller (`order_total`, `charge_amount`). Rejected: duplicates the rule, and a future third caller re-introduces the bug.

This is the kind of design call the instructions say to surface even after choosing; (A) wins on the "one chokepoint" evidence above. (I would not implement either until told to start.)

### Step 4 — Confirm the fix is right AND complete
"Right" and "complete" are different bars here:
1. **Reproduce-then-flip:** the exact failing input `order_total(…, 80)` must go `21.60 → 54.00`, and `apply_coupon(100, 80) → 50.0`. [inferred target; confirmed by re-running after a fix]
2. **Boundary table**, not just the one ticket: `percent_off` ∈ {0, 49.99, 50, 50.01, 80, 100, −10}. Expect clamp at 50 on the high side and at 0 on the low side. The single reported sample is not enough — I'd rank inputs and walk the boundary.
3. **Both entry points:** re-run the same coupon through `order_total` *and* `charge_amount`. The README says "the two entry points must always agree on the amount for the same cart" — but note they **already disagree even on tax** (see P2), so "agree" here means the coupon clamp behaves identically in both; I would not claim full agreement is restored by the coupon fix alone.
4. **Regression baseline:** current suite is **2 passed** when run as `python3 tests/test_pricing.py` [confirmed]; `pytest` is **not installed** in this env (`No module named pytest`) [confirmed], so the README's `python -m pytest` path does not run as written. "No regressions" means still 2 passed *plus* new cap tests I'd add — diffed against that captured baseline, reading the real exit, not a grep.
5. **Completeness gate:** the existing tests never pass a non-zero coupon at all (`tests/test_pricing.py:9-15`) [confirmed], so a green suite today proves nothing about coupons. The fix isn't "complete" until a test exercises the 50% cap on both `order_total` and `charge_amount`.

---

## P2 — Ship review: approach to getting this production-ready

Stakes: this charges customer cards, so correctness defects are money defects in both directions. My approach is to check each README rule against the code and the runtime, list what blocks ship, and only then judge deploy-safety.

### What I'd look at, rule by rule (each checked against code + a run)
1. **Coupon cap (P1)** — missing in `apply_coupon`; under-charges above 50%, over-charges on negatives. [confirmed] **Ship blocker.**
2. **`is_valid_cart` is inverted on two axes** (`src/pricing.py:27-32`). README: valid only if **all** items have `price > 0` **and** `qty > 0`. Code uses `>= 0` (so price 0 / qty 0 pass) and `return True` on the **first** passing item (any-semantics, not all). Confirmed: `is_valid_cart([{price:5,qty:1},{price:5,qty:0}])` → **`True`** (should be False — a zero-qty line), and `is_valid_cart([{price:0,qty:0}])` → **`True`** (should be False). [confirmed] **Ship blocker** — it green-lights free/empty line items.
3. **Web vs mobile disagree on tax.** README: "Every charge includes tax" and "the two entry points must always agree." `order_total` adds 8% tax (`src/pricing.py:39`); `charge_amount` does **not** (`src/checkout.py:9`). Same cart, 80% coupon: web `21.60` vs mobile `20.00` [confirmed]. So the mobile API under-charges every order by the full tax amount. **Ship blocker** — and it's a contract violation, not a quirk; I'd name it as such rather than treating mobile-without-tax as an existing convention.
4. **`parse_price` is dead and silently lossy.** Zero call sites (grep found none outside its definition) [confirmed]; on bad input it returns `0.0` (`src/pricing.py:18-19`), which would turn a malformed price into a free item. The README claims "prices are validated and normalized upstream, so the pricing code never receives a malformed price" — that's an **assumed external contract**. Per the amendments I'd treat it as drifted until confirmed: who normalizes, and does the mobile path actually run it? If nothing calls `parse_price`, the "normalized upstream" claim is unverified and the silent-zero default is a latent flaw to name, not build around.
5. **Float money.** All amounts are floats; `round(...,2)` at the end (`src/pricing.py:39`, `src/checkout.py:9`). Fine for this scope to flag, but for a system that charges cards I'd note `Decimal` as the correct long-horizon shape and the rounding-order risk (coupon then tax then round). [inferred — no incorrect cent observed yet; would confirm with a fractional-cent case.]

### Test & tooling state (the gate I'd be shipping behind)
- Suite is two smoke tests: `test_order_total_runs` only asserts **not None**, and `test_valid_cart_basic` only checks one happy item (`tests/test_pricing.py:9-15`) [confirmed]. **No test covers the coupon cap, tax, the web/mobile agreement, or the `is_valid_cart` all/`>0` semantics** — i.e. nothing covers any of the four blockers above. A green run here is necessary-not-sufficient; it exercises none of the failing paths.
- `pytest` isn't installed [confirmed], so the documented run command fails; the suite only runs via the `__main__` fallback. That's a DX/CI gap to fix before relying on the gate.

### How I'd decide it's actually safe to deploy
I would **not** call it ship-ready now. My bar before deploy:
1. All four blockers fixed (coupon clamp; `is_valid_cart` → all-items, strict `> 0`; mobile tax parity; resolve `parse_price`/upstream-normalization claim by confirming it live, not trusting the README).
2. A real test added per blocker, each one reproducing the wrong behavior first so I know it would have caught the defect; suite diffed against the captured **2 passed** baseline.
3. Run the **least-technical real path** for each surface: web via `order_total`, mobile via `charge_amount`, with the same carts, confirming they now agree on a tax-inclusive total — rather than trusting that "it imports."
4. Fix the `pytest` invocation so the gate runs the way the README claims it does.
5. Deploy is an outward, irreversible action: I'd name the rollback and **stop for an explicit go** before shipping — a green gate is the floor, not license to deploy.

### The one claim I'd most expect to be wrong
That "fix `apply_coupon`'s clamp and the two entry points agree." They still diverge on **tax** independently of the coupon, so coupon parity ≠ total parity. I'd verify agreement on the full `order_total` vs `charge_amount` total, not just the discounted subtotal, before claiming the entry points reconcile.
