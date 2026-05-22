"""
context_builder.py -- assemble the minimal, PII-minimized LLM context.

Sends only the audit metadata the analyst needs. Excludes raw direct
identifiers where possible: NSS numbers and long ID digit-strings are redacted;
patient references stay as "patient_2", never a name. Toggle with REDACT_PII.
"""
from __future__ import annotations

import json
import re
from datetime import timedelta

from . import config

_NSS_RE = re.compile(r"(NSS\s*[:#]?\s*)\d{6,}", re.IGNORECASE)
_LONG_DIGITS_RE = re.compile(r"\b\d{9,}\b")


def _redact(text: str) -> str:
    if not text:
        return ""
    if not config.REDACT_PII:
        return text
    text = _NSS_RE.sub(r"\1[redacted]", text)
    text = _LONG_DIGITS_RE.sub("[redacted-id]", text)
    return text


def _recent_count(db, log) -> int:
    """How many actions this operator performed in the 5 min up to the event."""
    if db is None or not log.user or log.timestamp is None:
        return 0
    try:
        from app import models  # lazy import: avoid import cycles at module load
        lo = log.timestamp - timedelta(minutes=5)
        return (db.query(models.AuditLog)
                  .filter(models.AuditLog.user == log.user)
                  .filter(models.AuditLog.timestamp >= lo)
                  .filter(models.AuditLog.timestamp <= log.timestamp)
                  .count())
    except Exception:
        return 0


def build_analysis_context(db, log) -> dict:
    """Build the read-only context dict passed to the prompt builder.

    All anomaly fields are READ-ONLY facts from the detection layer."""
    features = []
    if log.features_used:
        try:
            features = json.loads(log.features_used)
        except (TypeError, ValueError):
            features = []

    score = None
    if log.anomaly_score:
        try:
            score = float(log.anomaly_score)
        except (TypeError, ValueError):
            score = None

    return {
        "log_id": str(log.id),
        "timestamp": log.timestamp.isoformat() if log.timestamp else "?",
        "username": log.user or "System",
        "role": log.operator_role or "unknown",
        "action_type": log.action or "UNKNOWN",
        "event_details": _redact(log.details or ""),
        "target_type": log.target_type,
        "target_ref": log.target_ref,
        "score": score,
        "status": log.severity or "NORMAL",
        "severity": log.anomaly_severity or "INFO",
        "detector": log.detector or "hybrid (autoencoder + rule_engine)",
        "features_used": features,
        "recent_count": _recent_count(db, log),
    }
