# Variant: v5-minimal

Approach only. I did not edit `src/`, write a fix, or change behavior. I did *read* the code and *run* the existing functions read-only to ground the findings below, because the v5 amendment ("reproduce the reported symptom before you fix it... through the entry point they used") and the base instruction ("trace the call chain; don't guess behavior from a name") require it. Stakes read: low-blast, reversible — a small pure-Python pricing module, but it touches money, so correctness errors are real losses.

What follows separates **confirmed** (I ran it or read the exact line) from **inferred** (named as such, with what would confirm).

---

## P1 — Coupon under-charge bug report

### Step 0 — Reproduce the symptom by the real path, before theorizing

The report is "applied a coupon, charged less than they should have." There are two coupon entry points, and I'd reproduce against the one the customer actually hit before touching anything:

- Web checkout: `order_total(items, percent_off)` in `src/pricing.py:35`.
- Mobile API: `charge_amount(cart, coupon_percent)` in `src/checkout.py:6`.

Both funnel into `apply_coupon(amount, percent_off)` at `src/pricing.py:22`. The first thing I'd pin down from the order record is **which surface and what coupon percent** the customer used, because the under-charge can come from more than one place and the fix differs.

**Confirmed by running the code** (read-only, `python3` against `src/`):
- `apply_coupon(100.0, 60)` → `40.0`; `apply_coupon(100.0, 80)` → `20.0`.
- `order_total([{price:100,qty:1}], 60)` → `43.2` (i.e. 40.0 post-coupon, then ×1.08 tax).

### Step 1 — Primary cause: the 50% coupon cap does not exist in code

README.md:7-8 (spec) says coupons are **capped at 50% — a larger coupon is clamped to 50%.** `apply_coupon` at `src/pricing.py:22-24` is:

```python
def apply_coupon(amount, percent_off):
    return amount - amount * percent_off / 100
```

There is **no clamp anywhere** — not in `apply_coupon`, not in `order_total` (`pricing.py:35-39`), not in `charge_amount` (`checkout.py:6-9`). **Confirmed**: a 60% coupon takes 60% off and an 80% coupon takes 80% off (runs above). So any coupon over 50% under-charges by exactly the uncapped excess. This is the most likely cause of "charged less than they should have," and it matches the symptom direction precisely. I would name this as a real flaw, not a quirk: the spec's stated rule is simply not implemented.

I'd confirm it *is* the customer's cause (not just *a* bug) by checking the order's coupon percent: if it was > 50, this is the cause. If the coupon was ≤ 50, the cap is still a latent bug but **not** this customer's under-charge, and I keep digging rather than declaring victory on the first finding (base: "a finding is a hypothesis until you confirm it").

### Step 2 — If the coupon was ≤ 50%, check the next candidates, ranked

I would not stop at one sample. Ranked remaining causes for an under-charge:

1. **Negative / out-of-range percent.** `apply_coupon` does no lower-bound check either. A `percent_off` > 100 would flip the amount negative; that's an over-discount too. **Inferred** (would confirm by reading the order's stored percent and by testing `apply_coupon(100, 120)` → `-20.0`).
2. **Missing-tax disagreement between surfaces** (see P2 — the mobile path never adds tax). If "should have been charged" is judged against the tax-inclusive web figure but the customer paid via the mobile API, every mobile order looks like an under-charge by ~8%. **Confirmed the mechanism**: `order_total([{price:100,qty:1}], 0)` → `108.0` vs `charge_amount({items:[…]}, 0)` → `100.0`. Whether this is "the" bug depends on which surface the customer used — I'd confirm from the order before claiming it.
3. **A malformed price slipping past validation.** README.md:11 says prices are normalized upstream and pricing never sees a malformed price; `parse_price` (`pricing.py:14-19`) returns `0.0` on bad input. If upstream ever passes a raw string through `parse_price`, a bad price silently becomes `0.0` and under-charges. **Inferred** — I'd grep for `parse_price` callers to see whether the upstream guarantee actually holds, rather than trusting the README comment (base: don't take the spec on faith; trace the call chain).

### Step 3 — Confirm the fix is right and complete

I'm not writing the fix, but here's how I'd decide one is correct and complete:

- **Reproduce-then-verify on the same path.** Re-run the *exact* failing order (same surface, same coupon percent) through `order_total` / `charge_amount` and confirm the charge now matches the spec figure. A cousin case passing is not enough (v5 amendment).
- **Cap belongs in one place, not three.** Because both surfaces call `apply_coupon`, the clamp should live in `apply_coupon` (or a shared validator it calls) so web and mobile can't diverge. **Inferred** this is the right seam — confirm by checking every caller of `apply_coupon` (`order_total`, `charge_amount`) picks up the clamp with no second copy.
- **Boundary table.** 0%, 50% (exactly at cap), 50.01%, 60%, 100%, and an invalid negative — verify each clamps/handles as the spec says, both surfaces.
- **Baseline + delta on the gate.** Capture the test baseline *first* (see P2: pytest is not installed; the real gate today is the `__main__` runner, "2 passed"), then re-run after a fix and report the delta, not just "green." Note the current tests would *not* catch this bug — `test_order_total_runs` only asserts `is not None` (`tests/test_pricing.py:9-11`) — so passing tests prove nothing here; I'd add a failing test that reproduces the under-charge first (red), then make it green.
- **The most likely thing I'd still be wrong about:** that the customer's order actually used a >50% coupon. Everything hinges on that order record; I'd quote the stored percent and surface before calling it the root cause.

---

## P2 — Ship review

Stakes: this charges real cards, so the bar is correctness against the spec, not "tests pass." I'd review in this order.

### 1 — Run the real gate first and record a baseline

**Confirmed:** `python3 -m pytest tests/` fails with **"No module named pytest"** — pytest is not installed in this environment. The only gate that actually runs today is the fallback `python3 tests/test_pricing.py` (from inside `src/`, per the `sys.path` shim at `tests/test_pricing.py:4`), which prints **"2 passed"**. So "the tests pass" currently means two trivial assertions pass under a hand-rolled runner — not a real suite. I'd surface this honestly rather than report a green check: **the gate is effectively absent.** Before shipping I'd either install pytest in CI or treat the suite as untrusted.

### 2 — Walk each spec rule in README.md against the code

This is where the shippable/not call gets made. Findings, all **confirmed** by reading the lines and running the functions:

- **Coupon cap missing** — `apply_coupon` (`pricing.py:22-24`) never clamps to 50%. (Full detail in P1.) **Blocks ship** — it's a money-losing correctness bug on the spec's own rule.
- **`is_valid_cart` is wrong on two axes** (`pricing.py:27-32`):
  - Spec (README.md:10) requires **all** items valid; the function `return True` on the **first** valid item, so a cart of `[bad, good]` passes. **Confirmed:** `is_valid_cart([{price:-5,qty:1},{price:5,qty:1}])` → `True`. It's a logical any/all inversion: it should reject if *any* item is invalid.
  - Spec requires `price > 0` and `qty > 0`; the code uses `>= 0`. **Confirmed:** a zero-price item `is_valid_cart([{price:0,qty:1}])` → `True`, but the spec says that's invalid. This lets free/zero-priced line items through. **Blocks ship.**
- **Web and mobile disagree** — README.md:14 says "the two entry points must always agree on the amount for the same cart." They don't: `order_total` adds 8% tax (`pricing.py:39`), `charge_amount` does **not** (`checkout.py:6-9`). **Confirmed:** same cart → web `108.0`, mobile `100.0`. Per spec (README.md:9, "every charge includes tax"), the mobile path is **under-charging tax on every order.** **Blocks ship** — and note this also feeds P1's under-charge reports. Whether the right fix is "mobile must add tax" vs "spec is stale" is a fork I'd raise with the owner, leading with the spec text as the lever — but as written, mobile contradicts the spec.
- **`parse_price` silently zeroes bad input** (`pricing.py:14-19`) — returns `0.0` on `ValueError`/`TypeError`. README.md:11 claims pricing never receives a malformed price. I'd **confirm that upstream guarantee by grepping for callers** rather than trusting the comment; if anything routes raw user input through `parse_price`, a typo becomes a $0 line. I'd name the silent-zero default as a flaw regardless: it converts a data error into a silent under-charge instead of a rejection.

### 3 — Edges the current tests don't exercise

The suite (`tests/test_pricing.py`) tests one happy-path `order_total` (asserting only `is not None`) and one happy `is_valid_cart`. It exercises **none** of: coupon math, the 50% cap, 0%/negative/over-100% coupons, multi-item carts, invalid items, empty cart, web-vs-mobile agreement, tax application. Production-ready means adding tests that *fail today* for each spec rule above, then making them pass. A green suite here says nothing about the paths it doesn't touch (base: "a green suite is necessary, not sufficient").

### 4 — How I'd decide it's safe to deploy

It is **not safe to deploy as-is.** My ship gate:

1. Real test runner wired up (pytest in CI, or the runner blessed as the gate) with a recorded baseline.
2. Every README rule has a test that was red before the fix and green after: coupon cap, all-items validity, `> 0` strictness, tax-on-mobile, web≡mobile agreement.
3. The four confirmed correctness bugs (cap, two `is_valid_cart` defects, mobile tax) fixed and re-verified by reproducing the spec's expected amounts on **both** entry points — the path the work actually ships into, not just the happy one I tooled up (v5 amendment).
4. Decide the web-vs-mobile fork explicitly with the owner (does mobile add tax, or is the spec stale?) before changing charge amounts — that's a money-affecting, outward-facing call, so I'd get the yes rather than pick silently.
5. Confirm nothing else still speaks the old contract: any caller relying on `charge_amount` being tax-exclusive, or on `is_valid_cart`'s lenient behavior, must be checked before tightening.

**The one claim I'd most expect to be wrong / couldn't fully confirm:** that prices are truly normalized upstream (README.md:11). I read the comment but did not trace the upstream callers — that grep is the first thing I'd do before trusting `parse_price` can't under-charge.
