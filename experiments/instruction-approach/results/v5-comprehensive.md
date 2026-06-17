# Variant: v5-comprehensive

Approach only — no fixes written. Stakes read: **low-blast, reversible** (a tiny pure-Python pricing module, no I/O, no shared state). But it computes money, so correctness bugs here are silent revenue loss — I treat "right and complete" strictly, not "passes the two tests."

I read both instruction files, all of `src/pricing.py`, `src/checkout.py`, `tests/test_pricing.py`, `README.md`, and `PROBLEMS.md`. To keep claims confirmed rather than inferred, I also ran the code; the few facts below tagged **[confirmed: ran]** come from that, and I flag what is still **[inferred]**.

---

## P1 — Coupon under-charge bug report

The report is concrete: a coupon was applied and the customer was charged **less than they should have been**. My job is to reproduce *that* symptom by *that* path, find the cause, and define what "fixed and complete" means — without writing the fix.

### Step 1 — Pin down which path the customer actually went through
There are two entry points and the README says they "must always agree on the amount for the same cart." They do **not** agree, so the very first question is which one charged this order.

- Web checkout → `order_total(items, percent_off)` in `src/pricing.py` (subtotal → coupon → tax).
- Mobile API → `charge_amount(cart, coupon_percent)` in `src/checkout.py`, which calls `subtotal` then `apply_coupon` and **stops** — no tax.

**[confirmed: ran]** On a single $100 item: `order_total` with no coupon = `108.0`; `charge_amount` with no coupon = `100.0`. So `checkout.py` omits the 8% tax the README says "every charge includes." If this order came through the mobile API, that alone is an under-charge on *every* order, coupon or not. I would confirm the path from order metadata / logs before blaming the coupon, because the word "coupon" in the report may be a red herring for a tax-omission bug. This is the first fork and I would not guess it.

### Step 2 — Reproduce the reported symptom with the customer's real numbers
I would get the actual cart (line items, the coupon percent, the charged amount) from the order record and replay it through whichever entry point Step 1 identifies. The instructions require reproducing the *same* symptom by the *same* path before fixing — if I can only reproduce "a cousin" I stop and say so. Replaying the real order tells me immediately which of the candidate causes below is live.

### Step 3 — Read the coupon path against the spec and rank the causes
The README coupon rule has two parts: percentage off the subtotal, **and capped at 50% — a larger coupon is clamped to 50%.** Reading `apply_coupon`:

```python
def apply_coupon(amount, percent_off):
    return amount - amount * percent_off / 100
```

There is **no clamp**. Ranked by likelihood for an under-charge:

1. **Missing 50% cap (most likely true cause of a coupon under-charge).** A 60/80/100% coupon is honored in full. **[confirmed: ran]** an 80% coupon on $100 gives `order_total` = `21.6` (vs the spec's 50%-capped `54.0`), and `apply_coupon(100, 80)` = `20.0`. A coupon over 100% even goes negative (`order_total(..., 120)` = `-21.6` **[confirmed: ran]**) — a refund-to-the-customer, the worst form of under-charge. This is the single change most directly matching "applied a coupon, charged less than they should have been."
2. **Missing tax in `checkout.py` (Step 1).** A second, independent under-charge that stacks with the coupon if the order was mobile.
3. **Upstream coupon value.** README says prices are normalized upstream but says nothing about the coupon being pre-clamped — so the clamp is owned *here*. I would still check the caller to confirm nobody is supposed to clamp earlier, so I fix it at the right layer and don't double-clamp.

I would not stop at the first plausible cause; I would confirm which one(s) the real order actually hit (Step 2) and name the others as separate findings rather than silently folding them in.

### Step 4 — Confirm the fix is right *and complete* (the bar, stated before touching code)
"Complete" here is explicitly more than the current tests. Note the baseline: `tests/test_pricing.py` has only `test_order_total_runs` (asserts `order_total(...) is not None`) and `test_valid_cart_basic`. **The suite exercises zero coupon math and zero tax math** — a wrong coupon or missing tax passes today. So a green suite proves nothing about this bug; I will not lean on it. **[confirmed: ran]** the fallback runner (`python3 tests/test_pricing.py`) prints "2 passed"; `python3 -m pytest` exits 1 because **pytest is not installed in this env** (no module named pytest) — an env gotcha worth recording so "tests pass" isn't claimed off the wrong runner.

To call it fixed and complete I would require, *before* writing the fix, a failing test that reproduces the symptom, then turns green:
- A coupon-cap test: 80% (and a >100%) coupon clamps to 50% at the subtotal stage.
- A boundary test at exactly 50% (clamp must not alter a legal coupon).
- A tax test pinning `order_total` to the post-coupon + 8% number.
- The README's cross-entry-point invariant: **`order_total` and `charge_amount` agree on the same cart** — this is the test that would have caught the tax divergence and is the real definition of "done" for a two-entry-point money module.
- Re-run the whole gate and report the delta against the recorded baseline (today: 2 tests, both trivially green), not a grep narrowed to the file I touched.

I would flag the two parallel paths plainly: a coupon clamp in `apply_coupon` fixes **both** entry points (both call it) **[confirmed: both call `apply_coupon`]**, but the missing tax is `checkout.py`-only and is a *separate* decision — is mobile supposed to charge tax, or is the README wrong? That's a fork I'd surface, not silently "fix," because changing it changes what every mobile customer is charged. I would not push or commit anything; money-path changes wait for an explicit go.

---

## P2 — Ship review (correctness + production-readiness)

Goal: decide whether this is *actually* safe to deploy this week. Approach is to map every README rule to the code, run the real thing, and gate "ship" on observation rather than the existing green light.

### Step 1 — Treat the README as the contract and diff each rule against the code
Going rule by rule, here is what I found reading the source (and confirming by running it):

1. **Coupon cap at 50% — VIOLATED.** `apply_coupon` has no clamp (see P1). Over-100% coupons go negative. **[confirmed: ran]**
2. **Tax on every charge — VIOLATED in `checkout.py`.** `charge_amount` returns the post-coupon subtotal with no 8% tax; `order_total` includes it. The two entry points disagree, breaking the README's "must always agree" invariant. **[confirmed: ran: 100.0 vs 108.0]**
3. **Valid cart = ALL items have `price > 0` and `qty > 0` — VIOLATED, two ways, in `is_valid_cart`:**
   ```python
   for item in items:
       if item["price"] >= 0 and item["qty"] >= 0:
           return True
   return False
   ```
   - It uses `>=` (allows zero) where the spec says `> 0`. A free/zero-qty line is wrongly accepted.
   - It returns `True` on the **first** passing item — "any", not "all". A cart with one good item and one negative-price item is called valid. **[confirmed: ran]** `is_valid_cart([{price:5,qty:1},{price:-3,qty:0}])` → `True`, and `is_valid_cart([{price:0,qty:0}])` → `True`. Both are wrong per spec. This is a real flaw, and per the instructions I name it as broken rather than recasting it as a quirk.
4. **`parse_price` returns `0.0` on bad input — flaw to name, not silently honor.** The instructions are explicit about a "default that silently zeroes a real measurement." A malformed price becomes a free item rather than an error. The README does say prices are "validated and normalized upstream, so the pricing code never receives a malformed price" — so this may be dead defensiveness, but `parse_price` is also **unused** by either entry point. **[inferred: it is dead code]** — I would grep the wider repo/callers to confirm nothing imports it before deciding whether the zero-default is a latent landmine or just unreferenced. If it's a real upstream entry point, the silent-zero is a shippable money bug.

### Step 2 — Exercise the real entry points, not a proxy
The instructions stress verifying "the way it will actually be run." For this module that means calling `order_total` and `charge_amount` directly with representative carts (incl. coupon = 0, 50, 80, >100; carts with zero/negative items; empty cart), because the two tests exercise almost none of it. **[confirmed: ran]** the divergences above this way. I would also probe edge inputs the spec is silent on: empty `items` (both return `0`-ish, **[inferred]** — worth pinning), and float rounding (`round(..., 2)` — money in floats is a known foot-gun; I'd note whether half-cent rounding is acceptable for the business or whether this should be integer cents/Decimal, and flag it as a design question rather than fix it under a ship deadline).

### Step 3 — Assess the test suite as a safety net (it isn't one yet)
Baseline, recorded: 2 tests. `test_order_total_runs` only asserts the result is **not None** — it would pass even if the math were nonsense. `test_valid_cart_basic` only checks one trivially-valid cart and would pass against the buggy "any item" logic. **There is no test for coupon math, the cap, tax, the cross-entry-point invariant, or any invalid cart.** So the suite is green and means nothing — exactly the "green gate is the floor, not the goal," and "a green suite says nothing about a path it doesn't exercise" cases. **[confirmed: ran]** "2 passed" via the fallback runner; pytest is not installed here, an env gotcha to fix in CI so the documented `python -m pytest` command actually runs.

### Step 4 — The ship decision
**My recommendation: do not ship as-is.** Three confirmed correctness defects directly cause mis-charging customers — under-charge (no coupon cap; missing mobile tax) and wrong validation (`>=` and any-vs-all). The test suite cannot catch any of them, so "tests pass" is not evidence of safety. To make it shippable I would, in order:
1. Add failing tests that encode each README rule (cap, tax, all-items validity, the two-entry-point agreement invariant) — red first.
2. Land the fixes (separate, named: the cap in `apply_coupon`; the tax decision in `checkout.py`; the `>` and all-items logic in `is_valid_cart`) so each test goes green; re-run the **whole** gate and report the delta off the recorded 2-test baseline.
3. Resolve the two genuine forks with the owner before deploy, not unilaterally: **(a)** is mobile supposed to charge tax, or is the README wrong? **(b)** float vs integer-cents for money rounding. **(c)** is `parse_price`'s silent-zero a live path or dead code?
4. Get CI running pytest (currently uninstalled) so the documented command is real.

I would not commit, push, or deploy any of this without an explicit go — these are money-path changes, and the instructions gate irreversible/outward actions behind confirmation. The one claim I'd most expect to need owner input on: that `checkout.py` is *wrong* to omit tax — it's equally possible the README over-claims "every charge," and only the business can settle which contract is authoritative.

---

### Status / honesty notes
- **[confirmed: ran]** all numeric claims above (108.0 vs 100.0; 80% → 21.6 vs capped 54.0; 120% → -21.6; the two `is_valid_cart` cases; "2 passed"; pytest exit 1 = not installed).
- **[inferred, would confirm]**: `parse_price` being dead code (needs a repo-wide caller grep); empty-cart behavior; whether the tax omission or the README is the intended contract.
- I read and ran only; I changed nothing in `src/`, wrote no fix, and committed nothing. Files inspected: `/Users/shridhar/Code/ai/experiments/instruction-approach/src/pricing.py`, `/src/checkout.py`, `/tests/test_pricing.py`, `/README.md`, `/PROBLEMS.md`.
