"""Local charge bookkeeping in front of the processor.

Idempotency contract (see README.md): a charge is uniquely identified by
``(order_id, idempotency_key)``. Calling :meth:`charge` any number of times with
the same ``(order_id, idempotency_key)`` must result in exactly ONE remote
charge. Different idempotency keys for the same order are distinct, intentional
charges (the caller chose a new key).
"""
import time
import uuid

from processor import ProcessorTimeout


class PaymentService:
    def __init__(self, processor):
        self.processor = processor
        self.rows = []   # each: order_id, idempotency_key, processor_key, status, charge_id, amount

    def _find(self, order_id, idempotency_key):
        for r in self.rows:
            if r["order_id"] == order_id and r["idempotency_key"] == idempotency_key:
                return r
        return None

    def charge(self, order_id, idempotency_key, amount):
        row = self._find(order_id, idempotency_key)
        if row is not None and row["status"] == "paid":
            return row
        time.sleep(0.005)  # simulate a DB read / network round-trip
        if row is None:
            row = {"order_id": order_id, "idempotency_key": idempotency_key,
                   "processor_key": None, "status": "pending",
                   "charge_id": None, "amount": amount}
            self.rows.append(row)
        processor_key = "pk_" + uuid.uuid4().hex[:8]
        row["processor_key"] = processor_key
        try:
            res = self.processor.charge(amount, order_id, processor_key)
        except ProcessorTimeout:
            row["status"] = "pending"
            raise
        row["status"] = "paid"
        row["charge_id"] = res["id"]
        return row
