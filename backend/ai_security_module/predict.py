"""
predict.py
----------
Production-ready inference hook called from the backend on every audit-log
write. Lazy-loads model + preprocessor + threshold on first invocation and
caches them in-process.

Public API:
    check_live_log(entry: dict, db: Session | None = None) -> dict
        Returns:
            {
              "severity": "NORMAL" | "SUSPICIOUS" | "SUSPICIOUS_UNKNOWN_PATTERN",
              "score": float | None,    # reconstruction error
              "threshold": float | None,
              "reason": str | None,
            }

Design choices:
    - Fail-safe: any unexpected exception is caught and the log is tagged
      "SUSPICIOUS_UNKNOWN_PATTERN". The backend never crashes from the AI hook.
    - Cold start: if artifacts are missing (model not trained yet), severity
      defaults to "NORMAL" so the website keeps working until setup runs.
    - History-aware: when a SQLAlchemy session is supplied, we pull recent
      logs for the same user to compute rolling features identical to those
      used during training.
"""
from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timedelta
from typing import Any, Optional

import joblib
import pandas as pd
import torch

from .config import (
    MODEL_PATH,
    PREPROCESSOR_PATH,
    ROLLING_WINDOW_MINUTES,
    THRESHOLD_PATH,
)
from .model import Autoencoder

_LOCK = threading.Lock()
_STATE: dict[str, Any] = {
    "loaded": False,
    "model": None,
    "preprocessor": None,
    "threshold": None,
    "input_dim": None,
    "load_error": None,
}


def _artifacts_present() -> bool:
    return (
        os.path.isfile(MODEL_PATH)
        and os.path.isfile(PREPROCESSOR_PATH)
        and os.path.isfile(THRESHOLD_PATH)
    )


def _load_artifacts() -> None:
    """Lazy, thread-safe load of model + preprocessor + threshold."""
    if _STATE["loaded"]:
        return
    with _LOCK:
        if _STATE["loaded"]:
            return
        try:
            if not _artifacts_present():
                _STATE["load_error"] = "artifacts_missing"
                _STATE["loaded"] = True  # mark loaded; behave as cold start
                return

            preprocessor = joblib.load(PREPROCESSOR_PATH)
            with open(THRESHOLD_PATH, "r", encoding="utf-8") as f:
                meta = json.load(f)
            input_dim = int(meta.get("input_dim") or preprocessor.n_features)

            checkpoint = torch.load(MODEL_PATH, map_location="cpu")
            state_dict = checkpoint.get("state_dict", checkpoint)
            model = Autoencoder(input_dim=input_dim)
            model.load_state_dict(state_dict)
            model.eval()

            _STATE.update({
                "model": model,
                "preprocessor": preprocessor,
                "threshold": float(meta["threshold"]),
                "input_dim": input_dim,
                "load_error": None,
                "loaded": True,
            })
            print(f"[ai_security] Loaded autoencoder (input_dim={input_dim}, threshold={_STATE['threshold']:.6f})")
        except Exception as e:
            _STATE["load_error"] = f"load_failed:{e!r}"
            _STATE["loaded"] = True
            print(f"[ai_security] Failed to load artifacts: {e}")


def _fetch_history(db, user: str, now: datetime) -> Optional[pd.DataFrame]:
    """Query recent logs for the same user from our audit_logs table.
    Returns a DataFrame with columns [user, action, details, timestamp] or None."""
    if db is None or not user:
        return None
    try:
        # Lazy import to avoid circular dependency with the backend at module load.
        from app import models  # noqa: WPS433

        cutoff = now - timedelta(minutes=ROLLING_WINDOW_MINUTES)
        rows = (
            db.query(models.AuditLog)
            .filter(models.AuditLog.user == user)
            .filter(models.AuditLog.timestamp >= cutoff)
            .order_by(models.AuditLog.timestamp.asc())
            .limit(200)
            .all()
        )
        if not rows:
            return None
        return pd.DataFrame([
            {
                "user": r.user,
                "action": r.action,
                "details": r.details or "",
                "timestamp": r.timestamp,
            }
            for r in rows
        ])
    except Exception as e:
        # Never let history fetching break the hook
        print(f"[ai_security] history fetch failed: {e}")
        return None


def reset_cache() -> None:
    """Clear the in-process cache (used after retraining)."""
    with _LOCK:
        _STATE.update({
            "loaded": False,
            "model": None,
            "preprocessor": None,
            "threshold": None,
            "input_dim": None,
            "load_error": None,
        })


def check_live_log(entry: dict, db=None) -> dict:
    """Score a single audit-log entry and return its severity verdict."""
    try:
        _load_artifacts()

        # Cold start - model not trained yet: pass through as NORMAL.
        if _STATE.get("load_error") == "artifacts_missing":
            return {"severity": "NORMAL", "score": None,
                    "threshold": None, "reason": "model_not_trained"}
        if _STATE.get("load_error"):
            return {"severity": "SUSPICIOUS_UNKNOWN_PATTERN", "score": None,
                    "threshold": None, "reason": _STATE["load_error"]}

        model: Autoencoder = _STATE["model"]
        preprocessor = _STATE["preprocessor"]
        threshold = _STATE["threshold"]
        input_dim = _STATE["input_dim"]

        # Normalize timestamp
        ts = entry.get("timestamp") or datetime.utcnow()
        if isinstance(ts, str):
            try:
                ts = datetime.fromisoformat(ts)
            except ValueError:
                ts = datetime.utcnow()

        entry_norm = {
            "user": entry.get("user") or "System",
            "action": entry.get("action") or "UNKNOWN",
            "details": entry.get("details") or "",
            "timestamp": ts,
        }

        history_df = _fetch_history(db, entry_norm["user"], ts)
        vec = preprocessor.transform_one(entry_norm, history_df)

        if vec.shape[1] != input_dim:
            return {"severity": "SUSPICIOUS_UNKNOWN_PATTERN", "score": None,
                    "threshold": threshold,
                    "reason": f"shape_mismatch:{vec.shape[1]}!={input_dim}"}

        with torch.no_grad():
            t = torch.from_numpy(vec)
            err = model.reconstruction_error(t).item()

        severity = "SUSPICIOUS" if err > threshold else "NORMAL"
        return {
            "severity": severity,
            "score": float(err),
            "threshold": float(threshold),
            "reason": None,
        }
    except Exception as e:
        # Strict fail-safe: never propagate to the request handler.
        return {"severity": "SUSPICIOUS_UNKNOWN_PATTERN", "score": None,
                "threshold": None, "reason": f"exception:{e!r}"}
