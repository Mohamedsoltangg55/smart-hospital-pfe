"""
rule_engine.py
--------------
Deterministic, no-training rule engine -- the PRIMARY, high-precision signal
of the hybrid detector. The autoencoder is the SECONDARY "unknown pattern"
signal (see classifier.py and README.md).

Every rule is a pure function of a RuleContext. Rules can only RAISE an
event's status, never lower it. Each fired rule reports a stable name so the
UI and the (later) LLM-context layer can show *why* an event was flagged.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Callable, List, Optional, Tuple

from . import config
from .roles import role_of


@dataclass
class RuleContext:
    """Everything the rules need about a single audit event."""
    action: str
    details: str = ""
    timestamp: Optional[datetime] = None
    user: str = ""
    role: str = ""                                  # derived from user if empty
    recent_events: List[dict] = field(default_factory=list)
    # recent_events: [{"action": str, "timestamp": datetime}] for the SAME
    # operator -- used by the repeated-action burst rule.

    def __post_init__(self):
        self.action = (self.action or "").upper()
        self.details = self.details or ""
        if not self.role:
            self.role = role_of(self.user)


# --- Individual rules: each returns (status, rule_name) when it fires --------

def _rule_security_violation(ctx: RuleContext):
    # The SECURITY_VIOLATION action is, by name, an explicit policy breach
    # (e.g. unauthorized folder access blocked by the API layer). Emitting
    # CRITICAL keeps the 5-level severity ladder consistent: with this rule
    # firing, _severity_level() will map the event to CRITICAL severity.
    if ctx.action == "SECURITY_VIOLATION":
        return config.STATUS_CRITICAL, "SECURITY_VIOLATION"
    return None


def _rule_outside_consultation(ctx: RuleContext):
    text = ctx.details.lower()
    if any(phrase in text for phrase in config.OUTSIDE_CONSULTATION_PHRASES):
        return config.STATUS_SUSPICIOUS, "ACCESS_OUTSIDE_CONSULTATION"
    return None


def _rule_off_hours_login(ctx: RuleContext):
    if ctx.action == "USER_LOGIN" and ctx.timestamp is not None:
        hour = ctx.timestamp.hour
        if hour < config.OFFICE_HOURS_START or hour >= config.OFFICE_HOURS_END:
            return config.STATUS_SUSPICIOUS, "OFF_HOURS_LOGIN"
    return None


def _rule_repeated_actions(ctx: RuleContext):
    """Burst of actions by the same operator in a short window."""
    if ctx.timestamp is None or not ctx.recent_events:
        return None
    cutoff = ctx.timestamp - timedelta(minutes=config.BURST_WINDOW_MINUTES)
    count = 1  # the current event itself
    for ev in ctx.recent_events:
        ts = ev.get("timestamp")
        if ts is not None and cutoff <= ts <= ctx.timestamp:
            count += 1
    if count >= config.BURST_COUNT_CRITICAL:
        return config.STATUS_CRITICAL, "REPEATED_ACTIONS_BURST"
    if count >= config.BURST_COUNT_SUSPICIOUS:
        return config.STATUS_SUSPICIOUS, "REPEATED_ACTIONS_BURST"
    return None


def _rule_role_mismatch(ctx: RuleContext):
    """A role performing an action outside its mandate (e.g. cashier opening
    a patient folder)."""
    forbidden = config.ROLE_FORBIDDEN_ACTIONS.get(ctx.role, set())
    if ctx.action in forbidden:
        return config.STATUS_SUSPICIOUS, "ROLE_RESOURCE_MISMATCH"
    return None


# Registry -- add new rules here; order does not matter (status is max-merged).
RULES: List[Callable[[RuleContext], Optional[Tuple[str, str]]]] = [
    _rule_security_violation,
    _rule_outside_consultation,
    _rule_off_hours_login,
    _rule_repeated_actions,
    _rule_role_mismatch,
]


def evaluate(ctx: RuleContext) -> Tuple[str, List[str]]:
    """Run every rule. Return (highest_status, [fired_rule_names])."""
    status = config.STATUS_NORMAL
    fired: List[str] = []
    for rule in RULES:
        result = rule(ctx)
        if not result:
            continue
        rule_status, rule_name = result
        fired.append(rule_name)
        if config.STATUS_ORDER.index(rule_status) > config.STATUS_ORDER.index(status):
            status = rule_status
    return status, fired
