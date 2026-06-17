"""A fake payment processor that is idempotent by ``key``.

Like a real processor (Stripe et al.), charging twice with the *same* key
produces exactly ONE charge. It can also drop the response *after* durably
recording the charge (a timeout): the money moved, the caller just never heard
back.
"""
import threading
import uuid


class ProcessorTimeout(Exception):
    """Raised AFTER the charge is durably recorded (the network dropped the reply)."""


class FakeProcessor:
    def __init__(self):
        self._charges = {}            # key -> charge record
        self._lock = threading.Lock()
        self._fail_next = False
        self.remote_charge_count = 0  # number of DISTINCT remote charges actually created

    def fail_next_with_timeout(self):
        """The next *new* charge records remotely, then raises ProcessorTimeout."""
        self._fail_next = True

    def charge(self, amount, order_id, key):
        with self._lock:
            if key in self._charges:                 # idempotent: same key -> same charge
                return dict(self._charges[key])
            rec = {"id": "ch_" + uuid.uuid4().hex[:8], "amount": amount,
                   "order_id": order_id, "key": key}
            self._charges[key] = rec
            self.remote_charge_count += 1
            fail, self._fail_next = self._fail_next, False
        if fail:
            raise ProcessorTimeout(f"timeout after recording {rec['id']}")
        return dict(rec)

    def get_by_key(self, key):
        with self._lock:
            rec = self._charges.get(key)
            return dict(rec) if rec else None
