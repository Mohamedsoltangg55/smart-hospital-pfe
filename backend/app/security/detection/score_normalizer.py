"""
score_normalizer.py
-------------------
Converts a raw autoencoder reconstruction error (MSE, ~0.003-0.15, unbounded)
into a normalized 0.0-1.0 score that is easy to threshold and to show a human.

The normalized score is the event's estimated PERCENTILE RANK within normal
training traffic:
    0.00  == as calm as the quietest normal training event
    0.95  == more anomalous than 95% of normal events
    1.00  == at or above the worst normal event

Anchors (min, p50, p90, p95, p98, p99, max) are produced by train.py and stored
in the autoencoder's threshold.json. We interpolate linearly between them.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Optional

try:
    from ai_security_module.config import THRESHOLD_PATH
except Exception:  # keeps the module importable in unusual setups
    THRESHOLD_PATH = os.getenv("THRESHOLD_PATH", "")

# (percentile_rank, anchor_key) ordered low -> high
_ANCHOR_POINTS = [
    (0.00, "min"),
    (0.50, "p50"),
    (0.90, "p90"),
    (0.95, "p95"),
    (0.98, "p98"),
    (0.99, "p99"),
    (1.00, "max"),
]

_LOCK = threading.Lock()
_CACHE = {"loaded": False, "curve": None}


def _load_curve():
    """Return a sorted list of (error_value, percentile_rank), or None if the
    model has not been calibrated with score anchors yet."""
    if _CACHE["loaded"]:
        return _CACHE["curve"]
    with _LOCK:
        if _CACHE["loaded"]:
            return _CACHE["curve"]
        curve = None
        try:
            with open(THRESHOLD_PATH, "r", encoding="utf-8") as f:
                meta = json.load(f)
            anchors = meta.get("score_anchors") or {}
            pts = [
                (float(anchors[key]), float(rank))
                for rank, key in _ANCHOR_POINTS
                if key in anchors
            ]
            pts.sort()
            if len(pts) >= 2:
                curve = pts
        except Exception:
            curve = None
        _CACHE["curve"] = curve
        _CACHE["loaded"] = True
        return curve


def reset_cache() -> None:
    """Drop the cached anchor curve (call after retraining)."""
    with _LOCK:
        _CACHE["loaded"] = False
        _CACHE["curve"] = None


def normalize(raw_score: Optional[float]) -> Optional[float]:
    """Map a raw reconstruction error onto a 0.0-1.0 percentile-rank score.

    Returns None when no score is available or the model is not calibrated yet;
    callers treat None as a cold start (no tiering)."""
    if raw_score is None:
        return None
    curve = _load_curve()
    if not curve:
        return None

    e = float(raw_score)
    if e <= curve[0][0]:
        return 0.0
    if e >= curve[-1][0]:
        return 1.0

    for (e_lo, r_lo), (e_hi, r_hi) in zip(curve, curve[1:]):
        if e_lo <= e <= e_hi:
            if e_hi == e_lo:
                return r_hi
            frac = (e - e_lo) / (e_hi - e_lo)
            return max(0.0, min(1.0, r_lo + frac * (r_hi - r_lo)))
    return 1.0
