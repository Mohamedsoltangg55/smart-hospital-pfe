"""
calibration.py
--------------
Interim recalibration of the score-normalization anchors.

The autoencoder was trained on SYNTHETIC data, so its threshold.json anchors
reflect synthetic traffic and real audit events score above the whole
synthetic-normal range (everything saturates to CRITICAL). As a documented
stop-gap -- until enough real logs accumulate to retrain the model -- this
script recomputes the anchors from the raw reconstruction errors of REAL
benign audit_logs rows and writes them to anchors.json, which the score
normalizer prefers over the synthetic anchors (config.ANCHOR_SOURCE="real").

"Benign" = real rows excluding known-bad actions (SECURITY_VIOLATION). This is
a heuristic stop-gap; see README.md "Limitations & Future Work".

Usage (inside the backend container):
    python -m app.security.detection.calibration
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import numpy as np

from app.database import SessionLocal
from app import models
from app.security.detection import config

# Actions excluded from the "benign" calibration set (known-bad).
EXCLUDED_ACTIONS = {"SECURITY_VIOLATION"}


def recompute_anchors() -> dict:
    """Recompute normalization anchors from real benign audit logs and persist
    them to config.REAL_ANCHORS_PATH. Returns the written payload."""
    db = SessionLocal()
    try:
        scores = []
        for row in db.query(models.AuditLog).all():
            if (row.action or "").upper() in EXCLUDED_ACTIONS:
                continue
            if not row.anomaly_score:
                continue
            try:
                scores.append(float(row.anomaly_score))
            except (TypeError, ValueError):
                continue
    finally:
        db.close()

    if len(scores) < config.MIN_CALIBRATION_SAMPLES:
        raise RuntimeError(
            f"Only {len(scores)} benign scored rows; need "
            f">= {config.MIN_CALIBRATION_SAMPLES}. Accumulate more real logs."
        )

    arr = np.array(sorted(scores), dtype=float)
    anchors = {
        "min": float(arr.min()),
        "p50": float(np.percentile(arr, 50)),
        "p90": float(np.percentile(arr, 90)),
        "p95": float(np.percentile(arr, 95)),
        "p98": float(np.percentile(arr, 98)),
        "p99": float(np.percentile(arr, 99)),
        "max": float(arr.max()),
    }
    payload = {
        "source": "real_audit_logs",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "n_samples": len(scores),
        "excluded_actions": sorted(EXCLUDED_ACTIONS),
        "note": ("Interim anchors recomputed from real benign traffic. The "
                 "autoencoder is trained on synthetic data; replace these by "
                 "retraining the model once enough real logs exist."),
        "anchors": anchors,
    }
    with open(config.REAL_ANCHORS_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload


if __name__ == "__main__":
    print("[calibration] Recomputing anchors from real benign audit_logs...")
    try:
        result = recompute_anchors()
    except Exception as e:
        print(f"[calibration] FAILED: {e}", file=sys.stderr)
        sys.exit(1)
    print(f"[calibration] Wrote {config.REAL_ANCHORS_PATH}")
    print(f"[calibration] {result['n_samples']} benign samples -> {result['anchors']}")
    sys.exit(0)
