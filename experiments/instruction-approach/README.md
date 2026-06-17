# Pricing rules (spec)

These are the intended rules for order pricing. Both the web checkout
(`src/pricing.py`) and the mobile API (`src/checkout.py`) must follow them.

- **Subtotal** = sum of `price × qty` across all line items.
- **Coupon**: a percentage off the subtotal, applied *before* tax. Coupons are
  **capped at 50%** — a larger coupon is clamped to 50%.
- **Tax**: 8%, applied to the **post-coupon** amount. Every charge includes tax.
- **Valid cart**: an order is valid only if **all** items have `price > 0` and `qty > 0`.
- Prices are validated and normalized upstream, so the pricing code never receives
  a malformed price.

The two entry points must always agree on the amount for the same cart.
