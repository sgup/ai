"""Gold suite for the stale-permissions instance. Hidden from the agent.

Run against a copy:
    cd <copy> && PYTHONPATH=<copy> python -m pytest /…/gold/stale_permissions_gold.py -q

Every test uses UNIQUE user_ids / role names so the process-global cache & role
store don't leak across tests (no reset needed, robust to internal refactors).

Baseline (buggy) expectation:
  FAIL_TO_PASS (fail now, pass after a correct fix):
    F1 main-path downgrade · R1 API path · R2 worker path · R3 role-perm change
  PASS_TO_PASS (must stay green — guards against over/under-reach):
    R5 no overbroad flush (don't evict unrelated users) · R6 legacy session payload

Failure-mode reading:
  fails R1/R2/R3 -> under-scoped: didn't trace the parallel callers / all role mutators
  fails R5       -> overbroad:    used cache.clear() and flushed unrelated users
  passes all     -> traced every caller and preserved old-contract speakers
"""


import threading


def mods():
    import permissions, api_auth, worker_auth, sessions
    return permissions, api_auth, worker_auth, sessions


# ---- FAIL_TO_PASS ----------------------------------------------------------

def test_F1_downgrade_revokes_main_path():
    p, *_ = mods()
    p.set_role("f1", "admin")
    assert p.has_permission("f1", "delete")           # prime perm:f1 = admin
    p.update_role("f1", "viewer")
    assert not p.has_permission("f1", "delete"), "stale permission after role downgrade (main path)"


def test_R1_api_path_revokes_after_downgrade():
    p, api, *_ = mods()
    p.set_role("r1", "admin")
    assert api.api_authorize("r1", "delete")          # prime api:r1 = admin
    p.update_role("r1", "viewer")
    assert not api.api_authorize("r1", "delete"), "API middleware served a stale permission"


def test_R2_worker_path_revokes_after_downgrade():
    p, _api, wk, _se = mods()
    p.set_role("r2", "admin")
    assert wk.worker_can("r2", "delete")              # prime worker:r2 = admin
    p.update_role("r2", "viewer")
    assert not wk.worker_can("r2", "delete"), "worker path served a stale permission"


def test_R3_role_perm_change_propagates_all_paths():
    p, api, wk, _se = mods()
    p.update_role_perms("r3role", {"read", "write"})  # define a role
    p.set_role("r3u", "r3role")
    assert p.has_permission("r3u", "write")
    assert api.api_authorize("r3u", "write")
    assert wk.worker_can("r3u", "write")              # prime all three namespaces
    p.update_role_perms("r3role", {"read"})           # revoke write for the role
    assert not p.has_permission("r3u", "write"), "main path stale after role-perm change"
    assert not api.api_authorize("r3u", "write"), "API path stale after role-perm change"
    assert not wk.worker_can("r3u", "write"), "worker path stale after role-perm change"


# ---- PASS_TO_PASS (guards) -------------------------------------------------

def test_R5_update_does_not_evict_unrelated_users():
    p, *_ = mods()
    p.set_role("r5a", "admin")
    p.set_role("r5b", "admin")
    p.has_permission("r5a", "read")
    p.has_permission("r5b", "read")                   # prime both
    p.update_role("r5a", "viewer")                    # unrelated to r5b
    before = p.cache.set_count
    p.has_permission("r5b", "read")                   # r5b must be a cache HIT (no recompute)
    assert p.cache.set_count == before, \
        "an update to r5a evicted r5b's cache entry (overbroad flush / cache.clear())"


def test_R6_legacy_and_modern_sessions_authorize():
    p, _api, _wk, se = mods()
    p.set_role("r6", "admin")
    assert se.authorize_session({"uid": "r6", "role": "admin"}, "delete")   # legacy payload
    assert se.authorize_session({"user_id": "r6"}, "delete")                # current payload


# ---- FAIL_TO_PASS (concurrency property — deterministic) --------------------

def test_R4_no_stale_repopulation_after_update_returns():
    """Property: once update_role(...) has returned, no concurrent in-flight read
    may repopulate the cache with a permission computed from the OLD role.

    Deterministic via the cache's `_on_set` seam (not a stress loop): pause a
    reader at the instant it is about to write its old-role result, let the
    update fully land (mutate + invalidate), then release the reader. A fix that
    makes compute-and-write atomic w.r.t. the update (a lock spanning both, a
    generation/CAS check, a re-invalidate) survives; one that writes outside any
    such guard repopulates a stale value. Not tied to any specific mechanism —
    only to the property.
    """
    p, *_ = mods()
    uid = "r4u"
    target = f"perm:{uid}"
    p.set_role(uid, "admin")

    reader_at_write = threading.Event()
    release_reader = threading.Event()
    original = p.cache._on_set

    def seam(key):
        if key == target and not reader_at_write.is_set():
            reader_at_write.set()
            release_reader.wait(timeout=2.0)
    p.cache._on_set = seam

    def reader():
        p.has_permission(uid, "delete")          # computes 'admin', then writes -> seam
    rt = threading.Thread(target=reader)
    rt.start()

    assert reader_at_write.wait(timeout=2.0), "reader never reached the cache write"

    def updater():
        p.update_role(uid, "viewer")             # mutate + invalidate, then return
    ut = threading.Thread(target=updater)
    ut.start()
    ut.join(timeout=1.0)                          # let the update land (may block if reader holds a lock)
    release_reader.set()                          # release the reader regardless
    rt.join(timeout=2.0)
    ut.join(timeout=2.0)
    p.cache._on_set = original

    assert not p.has_permission(uid, "delete"), \
        "stale permission repopulated after update_role returned"
