"""
classifier.py
-------------
The detection layer's SINGLE SOURCE OF TRUTH for an audit event's status.

Hybrid pipeline:
    rule engine (PRIMARY)    -> rule_tier   (deterministic, high precision)
    autoencoder (SECONDARY)  -> score_tier  (normalized 0..1 -> tier)
    final status = max(rule_tier, score_tier)   # signals only RAISE

Also derives the section 6.1 fields: a 5-level `severity`, the list of
`features_used`, and `decided_by`. The LLM never runs here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from . import config
from .rule_engine import RuleContext, evaluate
from .score_normalizer import normalize


@dataclass
class Classification:
    status: str                          # final 3-tier: NORMAL | SUSPICIOUS | CRITICAL
    raw_score: Optional[float]           # raw autoencoder reconstruction error
    normalized_score: Optional[float]    # 0.0 - 1.0 percentile rank
    score_tier: str                      # tier from the autoencoder alone
    rule_tier: str                       # tier from the rule engine alone
    rule_overrides: List[str] = field(default_factory=list)  # fired rule names
    decided_by: str = "none"             # rule | autoencoder | both | none
    severity: str = "INFO"               # 5-level: INFO|LOW|MEDIUM|HIGH|CRITICAL
    features_used: List[str] = field(default_factory=list)
    reason: Optional[str] = None         # e.g. "model_not_calibrated"


def _tier_from_score(normalized: Optional[float]) -> str:
    if normalized is None:
        return config.COLD_START_STATUS
    if normalized >= config.CRITICAL_THRESHOLD:
        return config.STATUS_CRITICAL
    if normalized >= config.SUSPICIOUS_THRESHOLD:
        return config.STATUS_SUSPICIOUS
    return config.STATUS_NORMAL


def _rank(status: str) -> int:
    return config.STATUS_ORDER.index(status)


def _severity_level(status: str, fired_rules: List[str]) -> str:
    """Map the 3-tier status onto the 5-level section 6.1 severity."""
    if status == config.STATUS_NORMAL:
        return "INFO"
    if status == config.STATUS_SUSPICIOUS:
        return "MEDIUM"
    # CRITICAL: an explicit security violation is the worst case.
    if "SECURITY_VIOLATION" in fired_rules:
        return "CRITICAL"
    return "HIGH"


def classify(
    raw_score: Optional[float],
    action: Optional[str] = None,
    detector_status: Optional[str] = None,
    context: Optional[RuleContext] = None,
) -> Classification:
    """Map an autoencoder score + rule context onto a final classification.

    Pass a full `context` (RuleContext) to exercise every rule; passing only
    `action` builds a minimal context (action-based rules only)."""
    if context is None:
        context = RuleContext(action=action or "")

    # --- SECONDARY signal: autoencoder reconstruction error ---
    normalized = normalize(raw_score)
    score_tier = _tier_from_score(normalized)
    reason = None
    if normalized is None:
        if detector_status and "UNKNOWN" in detector_status.upper():
            score_tier = config.DETECTOR_ERROR_STATUS
            reason = "detector_error"
        else:
            score_tier = config.COLD_START_STATUS
            reason = "model_not_calibrated"

    # --- PRIMARY signal: deterministic rule engine ---
    rule_tier, fired = evaluate(context)

    # --- hybrid merge: the higher status wins ---
    final = score_tier if _rank(score_tier) >= _rank(rule_tier) else rule_tier

    rule_drives = _rank(rule_tier) == _rank(final) and _rank(final) > 0
    score_drives = _rank(score_tier) == _rank(final) and _rank(final) > 0
    if rule_drives and score_drives:
        decided_by = "both"
    elif rule_drives:
        decided_by = "rule"
    elif score_drives:
        decided_by = "autoencoder"
    else:
        decided_by = "none"

    # section 6.1 fields
    features_used = list(fired)
    if score_tier != config.STATUS_NORMAL:
        features_used.append("AUTOENCODER_SCORE")

    return Classification(
        status=final,
        raw_score=raw_score,
        normalized_score=normalized,
        score_tier=score_tier,
        rule_tier=rule_tier,
        rule_overrides=fired,
        decided_by=decided_by,
        severity=_severity_level(final, fired),
        features_used=features_used,
        reason=reason,
    )
