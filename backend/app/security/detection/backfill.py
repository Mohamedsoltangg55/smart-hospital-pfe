"""
backfill.py
-----------
One-time re-classification of existing audit_logs rows with the current
hybrid detector (rule engine + recalibrated autoencoder anchors).

Each row's status is recomputed from its STORED raw anomaly_score plus a rule
context (action, details, timestamp, operator, and that operator's recent
events). No model inference is needed, so it is fast and safe to re-run --
e.g. after recalibrating anchors or changing rule config.

Usage (inside the backend container):
    python -m app.security.detection.backfill
"""
from __future__ import annotations

import sys
from datetime import timedelta

from app.database import SessionLocal
from app import models
from app.security.detection.classifier import classify
from app.security.detection.rule_engine import RuleContext
from app.security.detection.score_normalizer import anchor_source

# How far back to look for an operator's recent events (covers the burst rule).
_HISTORY_WINDOW = timedelta(minutes=60)


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
            row.severity = result.status
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
