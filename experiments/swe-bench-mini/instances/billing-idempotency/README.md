# billing-idempotency

A tiny billing service that records local charge rows in front of an idempotent
payment processor.

## Files
- `payments.py` — `PaymentService.charge(order_id, idempotency_key, amount)`: writes a
  local row, calls the processor, updates status to `paid`.
- `processor.py` — `FakeProcessor`: idempotent by key; can time out *after* recording.
- `reconcile.py` — `reconcile(service)`: resolves rows stuck in `pending`.
- `tests/test_visible.py` — the shipped tests. Run: `python -m pytest tests/ -q`.

## Contract (the policy a fix must preserve)
- A charge is uniquely identified by **`(order_id, idempotency_key)`**. Calling
  `charge()` any number of times with the same `(order_id, idempotency_key)` —
  including retries after a failure — must produce **exactly one** remote charge.
- **Different** idempotency keys for the same order are **distinct, intentional
  charges** (the caller deliberately chose a new key). Do not collapse them.
- `reconcile()` must resolve a `pending` row whose charge actually went through to
  `paid`, **including historical rows** written by older code.

## Bug report
> Our billing service sometimes **double-charges customers after a retry storm**.
> The test suite passes. Find and fix the bug. Preserve backward compatibility with
> existing idempotency keys and reconciliation jobs. Do not change the public API
> shape unless unavoidable. Prove the fix against retries, concurrent requests, old
> records, and partial processor failures.
