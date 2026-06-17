# stale-permissions

A permission system with a cache in front of role lookups.

## Files
- `permissions.py` — `has_permission(user_id, perm)`; `set_role` / `update_role` /
  `update_role_perms`; the per-user permission cache.
- `api_auth.py` — `api_authorize(user_id, perm)`: the API middleware check.
- `worker_auth.py` — `worker_can(user_id, perm)`: the background-worker check.
- `sessions.py` — `authorize_session(session, perm)`: authorize from a session payload.
- `cache.py` — the permission cache.
- `tests/test_visible.py` — the shipped tests. Run: `python -m pytest tests/ -q`.

## Contract (what a fix must preserve)
- A permission decision must reflect the user's **current role** and the role's
  **current permissions**, on **every** path — main, API, and worker.
- **Preserve old cache keys and old session payloads:** legacy sessions
  (`{"uid": ...}`) and the current shape (`{"user_id": ...}`) must both authorize.
- **Do not over-invalidate:** a change to one user (or one role) must not flush
  unrelated users' cached permissions.

## Bug report
> Users report **stale permissions after role updates** — a downgraded admin keeps
> elevated access until the process restarts. The test suite passes. Fix it.
> Preserve old cache keys and old session payloads. Prove admin downgrade,
> role-permission change, concurrent updates, and legacy sessions behave correctly
> **across the API and worker paths**, and don't over-invalidate the cache.
