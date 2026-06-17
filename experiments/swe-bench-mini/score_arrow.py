"""Gold FAIL_TO_PASS scorer for the arrow-humanize SWE-mini instance.

Run against a (possibly patched) repo copy:
    PYTHONPATH=<repo-copy> python3 score_arrow.py

Exits 0 only if the bug is fixed. The exact weeks value (2 vs 3 weeks) is a
product choice, so we assert the *symptom* is gone (15/16/21 days no longer
read as "a month" and instead read as some weeks phrase) rather than an exact
string. PASS_TO_PASS (no regressions) is scored separately by running the
repo's own `tests/test_arrow.py::TestArrowHumanize` suite.
"""
import arrow

base = arrow.Arrow(2026, 1, 9)
ok = True
for d in (15, 16, 21):
    out = base.shift(days=d).humanize(base)
    if "month" in out or "week" not in out:
        print(f"  FAIL: +{d}d -> {out!r} (want a weeks phrase, not 'a month')")
        ok = False
    else:
        print(f"  ok:   +{d}d -> {out!r}")
print("FAIL_TO_PASS:", "PASS" if ok else "FAIL")
raise SystemExit(0 if ok else 1)
