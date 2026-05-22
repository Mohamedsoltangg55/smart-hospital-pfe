"""
backfill.py
-----------
One-time re-classification of existing audit_logs rows.

Before Phase 1 every scored row got a binary SUSPICIOUS status (raw threshold
0.0357), so historical rows look alarmist. This script recomputes each row's
3-tier status from its STORED raw anomaly_score using the new classifier --
no model inference is needed, so it is fast and safe to re-run.

Usage (inside the backend container):
    python -m app.security.detection.backfill
"""
from __future__ import annotations

import sys

from app.database import SessionLocal
from app import models
from app.security.detection.classifier import classify


def backfill() -> dict:
    db = SessionLocal()
    counts = {"NORMAL": 0, "SUSPICIOUS": 0, "CRITICAL": 0, "total": 0, "changed": 0}
    try:
        rows = db.query(models.AuditLog).all()
        for row in rows:
            counts["total"] += 1
            raw = None
            if row.anomaly_score:
                try:
                    raw = float(row.anomaly_score)
                except (TypeError, ValueError):
                    raw = None
            result = classify(raw_score=raw, action=row.action or "")
            if row.severity != result.status:
                counts["changed"] += 1
            row.severity = result.status
            counts[result.status] = counts.get(result.status, 0) + 1
        db.commit()
    finally:
        db.close()
    return counts


if __name__ == "__main__":
    print("[backfill] Re-classifying existing audit_logs rows...")
    summary = backfill()
    print(f"[backfill] Done -> {summary}")
    sys.exit(0)
