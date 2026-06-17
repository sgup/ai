"""Checkout flow used by the mobile API. Computes the amount to charge a card."""

from pricing import subtotal, apply_coupon


def charge_amount(cart, coupon_percent=0):
    """Amount to charge for a mobile order: subtotal with the coupon applied."""
    sub = subtotal(cart["items"])
    return round(apply_coupon(sub, coupon_percent), 2)
