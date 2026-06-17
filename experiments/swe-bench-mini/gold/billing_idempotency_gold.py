"""Gold suite for the billing-idempotency instance. Hidden from the agent.

Run against a (possibly patched) copy:
    cd <repo-copy> && python -m pytest /…/gold/billing_idempotency_gold.py -q

Baseline (buggy code) expectation:
  FAIL_TO_PASS (must fail now, pass after a correct fix):
    G1 retry · G4 concurrent (one remote charge) · G6 concurrent (one local row)
  PASS_TO_PASS (must stay passing — regression guards):
    G2 distinct-keys · G3 reconcile · G5 legacy

Separation: the boundary-only fix (deterministic processor key, no lock) passes
G1/G4 but still fails G6 (leaves duplicate local rows under concurrency); a fix
that also serializes the find-then-create race passes G6 too.
"""
import threading
from collections import Counter

import pytest

from payments import PaymentService
from processor import FakeProcessor, ProcessorTimeout
from reconcile import reconcile


def fresh():
    proc = FakeProcessor()
    return PaymentService(proc), proc


def _retry_storm(svc, rounds=40):
    """Fire `rounds` logical charges, each hit by two concurrent duplicate calls."""
    for i in range(rounds):
        oid, key = f"o{i}", f"k{i}"
        barrier = threading.Barrier(2)

        def worker():
            barrier.wait()
            try:
                svc.charge(oid, key, 100)
            except Exception:
                pass

        ts = [threading.Thread(target=worker) for _ in range(2)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()


# ---- FAIL_TO_PASS ----------------------------------------------------------

def test_G1_no_double_charge_on_retry_after_timeout():
    svc, proc = fresh()
    proc.fail_next_with_timeout()
    with pytest.raises(ProcessorTimeout):
        svc.charge("o1", "kA", 100)
    row = svc.charge("o1", "kA", 100)          # retry, same idempotency key
    assert proc.remote_charge_count == 1, f"double charged: {proc.remote_charge_count}"
    assert row["status"] == "paid"


def test_G4_concurrent_duplicates_one_remote_charge_per_pair():
    """Concurrent duplicate calls for the same (order_id, idempotency_key) must
    produce exactly ONE remote charge per logical pair."""
    svc, proc = fresh()
    rounds = 40
    _retry_storm(svc, rounds)
    assert proc.remote_charge_count == rounds, \
        f"expected {rounds} remote charges (one per (order_id, key) pair), got {proc.remote_charge_count}"


def test_G6_concurrent_duplicates_create_one_local_row():
    """Exactly one local row per (order_id, idempotency_key) after a concurrent
    retry storm — the local bookkeeping contract (README). A fix that dedups only
    at the processor boundary still leaves duplicate local rows."""
    svc, proc = fresh()
    rounds = 40
    _retry_storm(svc, rounds)
    counts = Counter((r["order_id"], r["idempotency_key"]) for r in svc.rows)
    dups = {k: c for k, c in counts.items() if c != 1}
    assert not dups, f"{len(dups)} logical charges have >1 local row (e.g. {list(dups.items())[:3]})"


# ---- PASS_TO_PASS (regression guards) --------------------------------------

def test_G2_distinct_keys_same_order_each_charge_once():
    svc, proc = fresh()
    svc.charge("o1", "kA", 100)
    svc.charge("o1", "kB", 100)               # different key => a separate intentional charge
    assert proc.remote_charge_count == 2


def test_G3_reconcile_pending_but_charged_marks_paid():
    svc, proc = fresh()
    proc.fail_next_with_timeout()
    with pytest.raises(ProcessorTimeout):
        svc.charge("o1", "kA", 100)
    reconcile(svc)                            # no retry — reconciliation must resolve it
    assert svc._find("o1", "kA")["status"] == "paid"
    assert proc.remote_charge_count == 1


def test_G5_legacy_pending_row_reconciles():
    svc, proc = fresh()
    legacy_key = "pk_legacy_001"
    proc.charge(100, "o9", legacy_key)        # historical remote charge under an old per-attempt key
    svc.rows.append({"order_id": "o9", "idempotency_key": "kOld",
                     "processor_key": legacy_key, "status": "pending",
                     "charge_id": None, "amount": 100})
    reconcile(svc)
    assert svc._find("o9", "kOld")["status"] == "paid", "legacy row orphaned by the fix"
    assert proc.remote_charge_count == 1
