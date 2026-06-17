"""The tests that ship with the service. They pass on the current code."""
from payments import PaymentService
from processor import FakeProcessor


def test_happy_path():
    proc = FakeProcessor()
    svc = PaymentService(proc)
    row = svc.charge("order1", "keyA", 100)
    assert row["status"] == "paid"
    assert proc.remote_charge_count == 1


def test_simple_retry_same_key_no_timeout():
    proc = FakeProcessor()
    svc = PaymentService(proc)
    svc.charge("order1", "keyA", 100)
    row = svc.charge("order1", "keyA", 100)   # caller retries; the first one already succeeded
    assert row["status"] == "paid"
    assert proc.remote_charge_count == 1
