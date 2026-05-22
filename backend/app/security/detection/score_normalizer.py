"""
score_normalizer.py
-------------------
Converts a raw autoencoder reconstruction error (MSE) into a normalized
0.0-1.0 score == the event's estimated percentile rank within BENIGN traffic.

Anchor source (config.ANCHOR_SOURCE):
  * "real"      -- anchors.json, recomputed from real benign audit logs by
                   calibration.py. Preferred default: the autoencoder was
                   trained on synthetic data and over-scores real traffic.
  * "synthetic" -- the autoencoder's own threshold.json["score_anchors"].
If "real" is selected but anchors.json is missing, we fall back to synthetic.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Optional

from . import config

try:
    from ai_security_module.config import THRESHOLD_PATH
except Exception:  # keeps the module importable in unusual setups
    THRESHOLD_PATH = os.getenv("THRESHOLD_PATH", "")

# (percentile_rank, anchor_key) ordered low -> high
_ANCHOR_POINTS = [
    (0.00, "min"), (0.50, "p50"), (0.90, "p90"), (0.95, "p95"),
    (0.98, "p98"), (0.99, "p99"), (1.00, "max"),
]

_LOCK = threading.Lock()
_CACHE = {"loaded": False, "curve": None, "source": None}


def _curve_from_anchors(anchors: dict):
    """Build a sorted [(error_value, percentile_rank)] curve, or None."""
    if not anchors:
        return None
    pts = [
        (float(anchors[key]), float(rank))
        for rank, key in _ANCHOR_POINTS
        if key in anchors
    ]
    pts.sort()
    return pts if len(pts) >= 2 else None


def _load_real():
    try:
        with open(config.REAL_ANCHORS_PATH, "r", encoding="utf-8") as f:
            payload = json.load(f)
        return _curve_from_anchors(payload.get("anchors") or {})
    except Exception:
        return None


def _load_synthetic():
    try:
        with open(THRESHOLD_PATH, "r", encoding="utf-8") as f:
            meta = json.load(f)
        return _curve_from_anchors(meta.get("score_anchors") or {})
    except Exception:
        return None


def _load():
    if _CACHE["loaded"]:
        return _CACHE["curve"]
    with _LOCK:
        if _CACHE["loaded"]:
            return _CACHE["curve"]
        curve, source = None, None
        if config.ANCHOR_SOURCE == "real":
            curve = _load_real()
            source = "real" if curve else None
        if not curve:
            curve = _load_synthetic()
            source = "synthetic" if curve else None
        _CACHE.update({"loaded": True, "curve": curve, "source": source})
        return curve


def anchor_source() -> Optional[str]:
    """Which anchor set is active: 'real' | 'synthetic' | None."""
    _load()
    return _CACHE["source"]


def reset_cache() -> None:
    """Drop the cached anchor curve (call after recalibrating / retraining)."""
    with _LOCK:
        _CACHE.update({"loaded": False, "curve": None, "source": None})


def normalize(raw_score: Optional[float]) -> Optional[float]:
    """Map a raw reconstruction error onto a 0.0-1.0 percentile-rank score.

    Returns None when no score is available or no anchors exist yet; callers
    treat None as a cold start (no score-based tiering)."""
    if raw_score is None:
        return None
    curve = _load()
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
