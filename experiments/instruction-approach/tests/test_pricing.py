"""Tests for the pricing module. Run: python -m pytest tests/ (or python tests/test_pricing.py)."""

import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from pricing import order_total, is_valid_cart


def test_order_total_runs():
    items = [{"price": 10.0, "qty": 2}]
    assert order_total(items) is not None


def test_valid_cart_basic():
    assert is_valid_cart([{"price": 5, "qty": 1}]) is True


if __name__ == "__main__":
    test_order_total_runs()
    test_valid_cart_basic()
    print("2 passed")
