"""A naive in-process permission cache.

Entries are keyed by opaque strings. Several key *shapes* coexist for historical
reasons (different teams added the API and worker paths) — see README.
"""
import threading


class PermissionCache:
    def __init__(self):
        self._data = {}
        self._lock = threading.Lock()
        self.set_count = 0   # number of cache writes (a recompute writes once)

    def get(self, key):
        with self._lock:
            return self._data.get(key)

    def set(self, key, value):
        self._on_set(key)
        with self._lock:
            self._data[key] = value
            self.set_count += 1

    def _on_set(self, key):
        """Test seam fired at the start of every cache write. Default no-op;
        the gold concurrency test patches it to force a worst-case update-vs-read
        interleaving. Production behavior is unchanged."""
        pass

    def invalidate(self, key):
        with self._lock:
            self._data.pop(key, None)

    def clear(self):
        with self._lock:
            self._data.clear()

    def keys(self):
        with self._lock:
            return list(self._data)
