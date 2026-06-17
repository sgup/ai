"""Authorize from a session payload.

Two payload shapes coexist: the legacy shape ``{"uid": ..., "role": ...}`` and the
current shape ``{"user_id": ...}``. Both must authorize against the user's CURRENT
permissions (the embedded legacy ``role`` is descriptive only — current role wins).
"""


def session_user_id(session):
    if "user_id" in session:
        return session["user_id"]
    return session["uid"]   # legacy payload


def authorize_session(session, perm):
    from permissions import has_permission
    return has_permission(session_user_id(session), perm)
