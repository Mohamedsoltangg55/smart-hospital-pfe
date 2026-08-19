"""
request_context.py
------------------
Per-request context shared with non-HTTP code paths.

The source IP of the current HTTP request is captured by a middleware in
main.py and stored here in a ContextVar, so `log_action()` can record it
without threading `request` through every call site.
"""
from __future__ import annotations

import contextvars
from typing import Optional

_source_ip: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "audit_source_ip", default=None
)


def set_source_ip(ip: Optional[str]) -> None:
    _source_ip.set(ip)


def get_source_ip() -> Optional[str]:
    return _source_ip.get()
