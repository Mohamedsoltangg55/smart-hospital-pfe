"""
backfill.py
-----------
One-time re-classification of existing audit_logs rows with the current
hybrid detector, and population of the Phase 2 (section 6.1) metadata columns.

Each row's status is recomputed from its STORED raw anomaly_score plus a rule
context (action, details, timestamp, operator, recent events). No model
inference is needed, so it is fast and safe to re-run -- e.g. after
recalibrating anchors or changing rule config.

Usage (inside the backend container):
    python -m app.security.detection.backfill
"""
from __future__ import annotations

import json
import re
import sys
from datetime import timedelta

from app.database import SessionLocal
from app import models
from app.security.detection import config
from app.security.detection.classifier import classify
from app.security.detection.roles import role_of
from app.security.detection.rule_engine import RuleContext
from app.security.detection.score_normalizer import anchor_source

# How far back to look for an operator's recent events (covers the burst rule).
_HISTORY_WINDOW = timedelta(minutes=60)
_PATIENT_RE = re.compile(r"patient\s*#?\s*(\d+)", re.IGNORECASE)


def backfill() -> dict:
    db = SessionLocal()
    counts = {"NORMAL": 0, "SUSPICIOUS": 0, "CRITICAL": 0, "total": 0, "changed": 0}
    try:
        # Chronological order so per-operator history only holds prior events.
        rows = db.query(models.AuditLog).order_by(models.AuditLog.timestamp.asc()).all()
        history: dict = {}  # user -> [{"action", "timestamp"}], chronological

        for row in rows:
            counts["total"] += 1
            raw = None
            if row.anomaly_score:
                try:
                    raw = float(row.anomaly_score)
                except (TypeError, ValueError):
                    raw = None

            user_hist = history.setdefault(row.user, [])
            recent = []
            if row.timestamp is not None:
                lo = row.timestamp - _HISTORY_WINDOW
                recent = [e for e in user_hist
                          if e["timestamp"] is not None and lo <= e["timestamp"] <= row.timestamp]

            ctx = RuleContext(
                action=row.action or "",
                details=row.details or "",
                timestamp=row.timestamp,
                user=row.user or "",
                recent_events=recent,
            )
            result = classify(raw_score=raw, context=ctx)

            if row.severity != result.status:
                counts["changed"] += 1
            # status (3-tier) + Phase 2 (section 6.1) metadata
            row.severity = result.status
            row.anomaly_severity = result.severity
            row.features_used = json.dumps(result.features_used)
            row.detector = config.DETECTOR_NAME
            row.operator_role = role_of(row.user or "")
            match = _PATIENT_RE.search(row.details or "")
            if match:
                row.target_type = "PATIENT_FOLDER"
                row.target_ref = f"patient_{match.group(1)}"

            counts[result.status] = counts.get(result.status, 0) + 1
            user_hist.append({"action": row.action or "", "timestamp": row.timestamp})

        db.commit()
    finally:
        db.close()
    return counts


if __name__ == "__main__":
    print(f"[backfill] anchor source = {anchor_source()}")
    print("[backfill] Re-classifying existing audit_logs rows...")
    summary = backfill()
    print(f"[backfill] Done -> {summary}")
    sys.exit(0)
