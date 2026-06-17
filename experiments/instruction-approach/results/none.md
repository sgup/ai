# Variant: none

Approach only — no fixes implemented. References are to the actual code in
`src/pricing.py`, `src/checkout.py`, `tests/test_pricing.py`, and the spec in
`README.md`.

---

## P1 — Coupon under-charge bug report

### Goal
A customer applied a coupon and was charged *less* than they should have been.
I need to find which code path produced the low charge, identify the root cause,
and confirm a fix is both correct (matches the spec) and complete (covers every
entry point, not just the one the customer hit).

### Step 1 — Reproduce against the spec, don't guess
The spec in `README.md` is the source of truth, and the relevant rule is:

> **Coupon**: a percentage off the subtotal, applied *before* tax. Coupons are
> **capped at 50%** — a larger coupon is clamped to 50%.

So "charged less than they should have been" via a coupon almost certainly means
a coupon larger than 50% was honored at full strength instead of being clamped.
I'd first reproduce by computing the expected charge for a plausible order (e.g.
a cart with a known subtotal and an 80% coupon) by hand from the spec, then run
the actual code on the same input and compare. That tells me whether the bug is
real and how big the gap is before I touch anything.

### Step 2 — Trace the coupon code path for the customer's order
The customer is a real charge, so I'd trace both directions of how a coupon
reaches money:

1. `pricing.apply_coupon(amount, percent_off)` (line 22-24):
   `return amount - amount * percent_off / 100`. This is pure arithmetic with
   **no clamp**. With `percent_off=80` it returns 20% of the amount — exactly
   the under-charge signature. This function is the prime suspect.
2. Its callers:
   - `pricing.order_total` (line 35-39, web checkout) calls
     `apply_coupon(sub, percent_off)` with the raw `percent_off` it was handed.
   - `checkout.charge_amount` (line 6-9, mobile API) calls
     `apply_coupon(sub, coupon_percent)` with the raw `coupon_percent`.

   Neither caller clamps either. So the 50% cap from the spec is **implemented
   nowhere**. That is the root cause: a >50% coupon is applied at full value on
   both entry points.

I'd confirm which entry point the customer actually came through (web vs mobile)
from the order/charge record, but the fix cannot stop at that one path — see
Step 4.

### Step 3 — Decide where the fix belongs (root cause, not symptom)
The cap is a single rule that both entry points must obey, and the spec says
"The two entry points must always agree." The right place to clamp is inside
`apply_coupon` itself (clamp `percent_off` to the 0–50 range before applying),
so every current and future caller inherits the cap and the two paths can't
drift. Clamping separately in `order_total` and `charge_amount` would be the
symptom-level fix and invites exactly the kind of divergence the spec warns
against. I'd note both `percent_off` and `coupon_percent` parameter names are
just two callers of the same function — fixing the function covers both.

While I'm in `apply_coupon` I'd also flag the lower bound: a negative
`percent_off` would *increase* the charge (over-charge), so a correct clamp is
to the `[0, 50]` interval, not just an upper cap. I'd confirm from product
whether negative is possible, but clamping both ends is the safe, spec-aligned
choice.

### Step 4 — Confirm the fix is right AND complete
Right (matches spec):
- Re-run the Step 1 hand-computed cases through the code: an 80% coupon must now
  charge as if 50%; a 30% coupon must be unchanged; 0% unchanged; exactly 50%
  unchanged (boundary). Verify on a subtotal where 50% vs 80% give visibly
  different money so rounding can't hide it.
- Check rounding/tax interaction: `order_total` applies tax *after* the coupon
  (`discounted + discounted * TAX_RATE`), so the clamp must sit before tax —
  confirm the clamped result still flows through the existing tax/round path.

Complete (covers every path and can't regress):
- Verify **both** `pricing.order_total` and `checkout.charge_amount` now return
  the clamped amount for the same cart + same >50% coupon, and that they agree
  with each other (the spec's hard requirement). Note `charge_amount` has no tax
  and `order_total` does — they should agree on the *pre-tax* discounted figure,
  which is what `apply_coupon` governs.
- Grep the repo for every call site of `apply_coupon` to make sure there's no
  third caller I missed.
- Add regression tests. The current `tests/test_pricing.py` is alarmingly weak
  here: `test_order_total_runs` only asserts the result `is not None` — it would
  pass even with the bug live. I'd add explicit value assertions for >50%, =50%,
  <50%, 0%, and (if applicable) negative coupons, plus an equivalence test that
  asserts the web and mobile paths agree for the same cart. Tests must fail on
  the current code and pass after the fix; otherwise they prove nothing.

---

## P2 — Ship review (production readiness)

### Goal
Decide whether this module is actually safe to deploy this week. My approach is
to check the code against its own spec, gauge the real risk (this computes money
charged to cards), and define a concrete bar for "safe to ship."

### Step 1 — Reconcile every spec rule against the code
`README.md` lists five rules. I'd walk each one to the implementing code and mark
agree/disagree. Doing this surfaces more than the P1 bug:

1. **Subtotal** — `subtotal` (line 6-11) sums `price * qty`. Matches spec.
2. **Coupon cap at 50%** — *not implemented anywhere* (see P1). **Fails spec.**
   Causes real money loss. Must fix before ship.
3. **Tax 8% on post-coupon, every charge includes tax** —
   - `order_total` (line 35-39) applies 8% after the coupon. Matches spec.
   - But `checkout.charge_amount` (line 6-9) applies **no tax at all**. The spec
     says "Every charge includes tax" and "The two entry points must always
     agree on the amount for the same cart." The mobile API under-charges every
     order by the full tax amount and **disagrees with the web path on every
     order**. This is a second, larger money-loss bug than P1 and is the most
     important finding of the review. I'd confirm with product that mobile is
     meant to include tax (the README is unambiguous) and treat this as a
     ship-blocker.
4. **Valid cart: all items must have `price > 0` and `qty > 0`** —
   `is_valid_cart` (line 27-32) is wrong on two counts:
   - It uses `>= 0`, so it accepts price 0 and qty 0; spec demands strictly `> 0`.
   - It returns `True` on the **first** acceptable item (`return True` inside the
     loop), i.e. ANY-valid logic, but the spec requires ALL items valid. A cart
     with one good item and one junk item is wrongly accepted. The correct shape
     is "return False on any bad item, True only after the loop." **Fails spec
     on both logic and boundary.**
   - I'd also check whether `is_valid_cart` is even called before pricing —
     nothing in `pricing.py` or `checkout.py` invokes it, so invalid carts may
     reach the money math regardless. Worth confirming who the gatekeeper is.
5. **Prices validated/normalized upstream; pricing never receives a malformed
   price** — `parse_price` (line 14-19) exists and swallows bad input to `0.0`,
   but nothing in the pricing path calls it, and `subtotal` assumes numeric
   `price`/`qty`. I'd verify the upstream-validation assumption actually holds
   in the calling services; if it doesn't, `subtotal` will raise or silently
   mis-add. This is an assumption to confirm, not necessarily a code change.

### Step 2 — Assess money/rounding correctness specifically
Because this charges cards, I'd scrutinize:
- **Rounding**: `round()` uses banker's rounding in Python; for currency this can
  produce off-by-a-cent surprises and the two entry points round at different
  stages (`charge_amount` rounds the discounted subtotal; `order_total` rounds
  after tax). I'd check whether finance expects half-up and whether
  Decimal/cents-as-int is warranted. Flag as a correctness risk even if not a
  hard blocker this week.
- **Negative / out-of-range coupons** (from P1) — a negative percent over-charges
  the customer, which is a worse failure mode than under-charging. Clamp range,
  not just a cap.
- **Empty cart** — `subtotal([])` returns 0, `order_total([])` returns 0.0; decide
  if a zero-item order should even be chargeable.

### Step 3 — Judge the test suite as a safety net
`tests/test_pricing.py` has only two tests and both are near-useless as guards:
`test_order_total_runs` asserts only `is not None`, and `test_valid_cart_basic`
asserts one trivially-true case. There are **zero** assertions on actual computed
amounts, zero coupon-cap tests, zero tax tests, zero web-vs-mobile agreement
tests, and zero negative/boundary tests. So the current green test run gives no
confidence whatsoever. I would not treat "tests pass" as evidence of anything
until the suite actually pins down values for every spec rule.

### Step 4 — Define the "safe to deploy" bar
I'd block ship until:
1. The three spec violations are fixed: coupon cap (P1), mobile tax omission, and
   `is_valid_cart` (all-items + strict `> 0`).
2. A real test suite exists with explicit numeric assertions per spec rule,
   including a cross-entry-point equivalence test proving `order_total` and
   `charge_amount` agree for the same cart (per the README's hard requirement),
   plus boundary cases (coupon 0/50/>50/negative, qty/price at 0). Each new test
   must fail on today's code and pass after the fix.
3. The upstream "prices are pre-validated" assumption is confirmed by the actual
   callers, or `parse_price`/validation is wired into the pricing path.
4. Rounding/currency behavior is confirmed acceptable with finance.

Then I'd re-run the full suite and re-do the hand-computed money checks for a few
representative orders on both entry points. Only when code matches spec on every
rule, both paths agree, and the tests actually encode those expectations would I
call it safe to deploy. The headline for stakeholders: this module currently
under-charges in at least two distinct ways (uncapped coupons and missing mobile
tax) and accepts invalid carts, and its tests would not have caught any of it —
it is not shippable as-is, but the fixes are small and well-scoped.
