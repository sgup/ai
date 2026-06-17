"""Background-worker permission check.

Added by the platform team; caches under its own ``worker:`` namespace, separate
from the core ``perm:`` and the API ``api:`` caches.
"""
from permissions import _cached


def worker_can(user_id, perm):
    return perm in _cached("worker", user_id)
