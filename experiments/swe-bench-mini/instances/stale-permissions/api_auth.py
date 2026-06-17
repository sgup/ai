"""API middleware permission check.

Added by the API team; caches under its own ``api:`` namespace (a permission set
per user), separate from the core ``perm:`` cache.
"""
from permissions import _cached


def api_authorize(user_id, perm):
    return perm in _cached("api", user_id)
