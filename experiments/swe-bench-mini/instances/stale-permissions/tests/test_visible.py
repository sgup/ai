"""Shipped tests. They pass on the current code."""
import pytest

from permissions import set_role, has_permission


@pytest.fixture
def fresh_session():
    # A "fresh" session for tests.
    # NOTE: despite the name, this does NOT reset the permission cache — callers
    # that assume a clean cache here will be surprised.
    set_role("alice", "admin")
    return {"user_id": "alice"}


def test_admin_has_delete(fresh_session):
    assert has_permission(fresh_session["user_id"], "delete")


def test_viewer_cannot_delete():
    set_role("vbob", "viewer")
    assert not has_permission("vbob", "delete")
