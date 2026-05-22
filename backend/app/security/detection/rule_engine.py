"""
rule_engine.py
--------------
Deterministic, rule-based hard overrides applied AFTER the autoencoder score.

Rules can only RAISE an event's status, never lower it. They encode security
policy that must hold regardless of what the model thinks -- e.g. a
SECURITY_VIOLATION is always at least SUSPICIOUS even if its score looks low.
"""
from __future__ import annotations

from typing import List, Tuple

from .config import RULE_OVERRIDES, STATUS_NORMAL


def apply_rules(action: str) -> Tuple[str, List[str]]:
    """Return (minimum_status, fired_rule_names) for the given action type."""
    if not action:
        return STATUS_NORMAL, []
    override = RULE_OVERRIDES.get(action.upper())
    if not override:
        return STATUS_NORMAL, []
    min_status, rule_name = override
    return min_status, [rule_name]
