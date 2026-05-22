"""
classifier.py
-------------
The detection layer's SINGLE SOURCE OF TRUTH for an audit event's status.

Pipeline:
    raw autoencoder error  --normalize--> 0..1 score
    0..1 score             --thresholds--> base status (NORMAL/SUSPICIOUS/CRITICAL)
    base status            --rule engine-> final status (rules can only raise it)

The badge, the row highlight and (later) the "AI Security Analysis" button all
derive from `classify()`. The LLM layer never runs here.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional

from . import config
from .rule_engine import apply_rules
from .score_normalizer import normalize


@dataclass
class Classification:
    status: str                          # NORMAL | SUSPICIOUS | CRITICAL
    raw_score: Optional[float]           # raw autoencoder reconstruction error
    normalized_score: Optional[float]    # 0.0 - 1.0 percentile rank
    rule_overrides: List[str] = field(default_factory=list)
    reason: Optional[str] = None         # e.g. "model_not_calibrated"


def _tier_from_score(normalized: Optional[float]) -> str:
    if normalized is None:
        return config.COLD_START_STATUS
    if normalized >= config.CRITICAL_THRESHOLD:
        return config.STATUS_CRITICAL
    if normalized >= config.SUSPICIOUS_THRESHOLD:
        return config.STATUS_SUSPICIOUS
    return config.STATUS_NORMAL


def _max_status(a: str, b: str) -> str:
    order = config.STATUS_ORDER
    return a if order.index(a) >= order.index(b) else b


def classify(
    raw_score: Optional[float],
    action: str,
    detector_status: Optional[str] = None,
) -> Classification:
    """Map an autoencoder score + action type onto a final 3-tier status."""
    normalized = normalize(raw_score)
    base = _tier_from_score(normalized)
    reason = None

    if normalized is None:
        # No usable score. Distinguish "not trained yet" from "detector errored".
        if detector_status and "UNKNOWN" in detector_status.upper():
            base = config.DETECTOR_ERROR_STATUS
            reason = "detector_error"
        else:
            base = config.COLD_START_STATUS
            reason = "model_not_calibrated"

    # Rule engine: deterministic hard overrides; can only raise the status.
    rule_min, fired = apply_rules(action)
    final = _max_status(base, rule_min)

    return Classification(
        status=final,
        raw_score=raw_score,
        normalized_score=normalized,
        rule_overrides=fired,
        reason=reason,
    )
