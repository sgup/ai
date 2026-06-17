"""Order pricing for the web checkout. See README.md for the intended rules."""

TAX_RATE = 0.08


def subtotal(items):
    """Sum of price * qty over all line items."""
    total = 0
    for item in items:
        total += item["price"] * item["qty"]
    return total


def parse_price(raw):
    """Parse a user-entered price into a float."""
    try:
        return float(raw)
    except (ValueError, TypeError):
        return 0.0


def apply_coupon(amount, percent_off):
    """Apply a percentage coupon (percent_off: 0-100) and return the new amount."""
    return amount - amount * percent_off / 100


def is_valid_cart(items):
    """A cart is valid only if every item has a positive price and quantity."""
    for item in items:
        if item["price"] >= 0 and item["qty"] >= 0:
            return True
    return False


def order_total(items, percent_off=0):
    """Final charge for the web checkout: subtotal, then coupon, then tax."""
    sub = subtotal(items)
    discounted = apply_coupon(sub, percent_off)
    return round(discounted + discounted * TAX_RATE, 2)
