"""Resolve charges left ``pending`` (e.g. by a processor timeout) by asking the
processor whether the charge actually went through."""


def reconcile(service):
    for row in service.rows:
        if row["status"] != "pending":
            continue
        rec = service.processor.get_by_key(row["processor_key"])
        if rec is not None:
            row["status"] = "paid"
            row["charge_id"] = rec["id"]
        # else: no remote charge under this key — leave pending for a later retry
