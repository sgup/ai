"""Core permission checks with a per-user cache.

A permission decision must reflect the user's CURRENT role and the role's CURRENT
permissions. Several call sites cache by their own namespace (see api_auth.py,
worker_auth.py) — they all share this module's `cache` and `_compute`.
"""
import threading

from cache import PermissionCache

ROLE_PERMS = {
    "admin":  {"read", "write", "delete", "manage_users"},
    "editor": {"read", "write"},
    "viewer": {"read"},
}

cache = PermissionCache()
_roles = {}            # user_id -> role name
_lock = threading.Lock()


def set_role(user_id, role):
    """Initial role assignment."""
    with _lock:
        _roles[user_id] = role


def _compute(user_id):
    with _lock:
        role = _roles.get(user_id)
        return set(ROLE_PERMS.get(role, set()))


def _cached(namespace, user_id):
    """Shared cached lookup used by every entrypoint (main / api / worker)."""
    key = f"{namespace}:{user_id}"
    perms = cache.get(key)
    if perms is None:
        perms = _compute(user_id)
        cache.set(key, perms)
    return perms


def has_permission(user_id, perm):
    return perm in _cached("perm", user_id)


def update_role(user_id, new_role):
    """Change a user's role."""
    with _lock:
        _roles[user_id] = new_role
    # NOTE: cached permissions are not touched here.


def update_role_perms(role, new_perms):
    """Change what a role is allowed to do (affects every user with that role)."""
    with _lock:
        ROLE_PERMS[role] = set(new_perms)
    # NOTE: cached permissions are not touched here.
