"""
preprocess.py
-------------
Maps healthcare audit logs (columns: user, action, details, timestamp) onto
a numeric feature tensor consumable by the Autoencoder.

Engineered features:
    Cyclic time encodings:
        - hour_sin, hour_cos          (24h cycle)
        - dow_sin,  dow_cos           (7d cycle)
    Numeric behavior signals (per actor, scaled with MinMaxScaler):
        - actions_last_hour           (count by same user in last 60min)
        - actions_last_5min           (rapid-burst signal)
        - distinct_actions_last_hour
        - seconds_since_user_last     (capped at 86400)
        - is_off_hours                (0/1: outside 7-20 local time)
        - is_weekend                  (0/1)
        - details_length
    Categorical (OneHotEncoded):
        - action
        - user_bucket                 (role-like bucket inferred from username)

The Preprocessor exposes:
    fit_transform(df) -> np.ndarray
    transform(df)     -> np.ndarray
    transform_one(entry, history_df) -> np.ndarray   # live inference

The fitted object is persisted as a single joblib artifact.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import numpy as np
import pandas as pd
from sklearn.preprocessing import MinMaxScaler, OneHotEncoder

from .config import RAPID_BURST_WINDOW_MINUTES, ROLLING_WINDOW_MINUTES

NUMERIC_FEATURES = [
    "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    "actions_last_hour", "actions_last_5min",
    "distinct_actions_last_hour", "seconds_since_user_last",
    "is_off_hours", "is_weekend", "details_length",
]


def _user_bucket(username: str) -> str:
    """Coarse role bucket inferred from username prefix.
    Live logs without a prefix fall into 'other'."""
    if not isinstance(username, str):
        return "other"
    u = username.lower()
    if u.startswith("dr_") or u.startswith("doctor"):
        return "doctor"
    if u.startswith("nurse"):
        return "nurse"
    if u.startswith("reception"):
        return "reception"
    if u.startswith("cashier"):
        return "cashier"
    if u.startswith("lab"):
        return "lab"
    if "admin" in u:
        return "admin"
    return "other"


def _to_datetime(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, errors="coerce", utc=False)


def _compute_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    """Adds rolling-window behavioral features per user. df must be sorted by timestamp."""
    out = df.copy()
    out["timestamp"] = _to_datetime(out["timestamp"])
    out = out.sort_values("timestamp").reset_index(drop=True)

    actions_last_hour: List[int] = []
    actions_last_5min: List[int] = []
    distinct_last_hour: List[int] = []
    seconds_since_last: List[float] = []

    # Per-user sliding deques (timestamps + actions)
    history: Dict[str, List[tuple]] = {}

    win_hour = timedelta(minutes=ROLLING_WINDOW_MINUTES)
    win_burst = timedelta(minutes=RAPID_BURST_WINDOW_MINUTES)

    for _, row in out.iterrows():
        u = row["user"] if isinstance(row["user"], str) else "System"
        ts = row["timestamp"]
        if pd.isna(ts):
            ts = datetime.utcnow()

        hist = history.setdefault(u, [])
        # Drop events older than the longest window
        cutoff_hour = ts - win_hour
        while hist and hist[0][0] < cutoff_hour:
            hist.pop(0)

        within_hour = hist  # all are within the hour after pruning
        within_burst = [h for h in hist if h[0] >= ts - win_burst]

        actions_last_hour.append(len(within_hour))
        actions_last_5min.append(len(within_burst))
        distinct_last_hour.append(len({h[1] for h in within_hour}))

        if within_hour:
            delta = (ts - within_hour[-1][0]).total_seconds()
        else:
            delta = 86400.0
        seconds_since_last.append(min(delta, 86400.0))

        hist.append((ts, row["action"] if isinstance(row["action"], str) else "UNKNOWN"))

    out["actions_last_hour"] = actions_last_hour
    out["actions_last_5min"] = actions_last_5min
    out["distinct_actions_last_hour"] = distinct_last_hour
    out["seconds_since_user_last"] = seconds_since_last
    return out


def _add_static_features(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    ts = _to_datetime(out["timestamp"])
    hour = ts.dt.hour.fillna(12).astype(int)
    dow = ts.dt.dayofweek.fillna(0).astype(int)

    out["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    out["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    out["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    out["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)
    out["is_off_hours"] = ((hour < 7) | (hour > 20)).astype(int)
    out["is_weekend"] = (dow >= 5).astype(int)

    details = out["details"].fillna("").astype(str)
    out["details_length"] = details.str.len().clip(upper=500)

    out["user_bucket"] = out["user"].apply(_user_bucket)
    out["action"] = out["action"].fillna("UNKNOWN").astype(str)
    return out


@dataclass
class Preprocessor:
    numeric_scaler: MinMaxScaler = field(default_factory=MinMaxScaler)
    action_encoder: OneHotEncoder = field(default=None)
    role_encoder: OneHotEncoder = field(default=None)
    feature_names: List[str] = field(default_factory=list)
    n_features: int = 0

    def _new_ohe(self) -> OneHotEncoder:
        # sklearn >= 1.2 deprecates `sparse`; use sparse_output if available.
        try:
            return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
        except TypeError:
            return OneHotEncoder(handle_unknown="ignore", sparse=False)

    def fit(self, df: pd.DataFrame) -> "Preprocessor":
        enriched = _compute_rolling_features(_add_static_features(df))
        self.numeric_scaler = MinMaxScaler()
        self.numeric_scaler.fit(enriched[NUMERIC_FEATURES].values)

        self.action_encoder = self._new_ohe()
        self.action_encoder.fit(enriched[["action"]].values)

        self.role_encoder = self._new_ohe()
        self.role_encoder.fit(enriched[["user_bucket"]].values)

        action_names = [f"action={c}" for c in self.action_encoder.categories_[0]]
        role_names = [f"role={c}" for c in self.role_encoder.categories_[0]]
        self.feature_names = NUMERIC_FEATURES + action_names + role_names
        self.n_features = len(self.feature_names)
        return self

    def transform(self, df: pd.DataFrame) -> np.ndarray:
        enriched = _compute_rolling_features(_add_static_features(df))
        num = self.numeric_scaler.transform(enriched[NUMERIC_FEATURES].values)
        act = self.action_encoder.transform(enriched[["action"]].values)
        role = self.role_encoder.transform(enriched[["user_bucket"]].values)
        return np.concatenate([num, act, role], axis=1).astype(np.float32)

    def fit_transform(self, df: pd.DataFrame) -> np.ndarray:
        self.fit(df)
        return self.transform(df)

    # ---------- Live single-entry inference ----------
    def transform_one(
        self,
        entry: dict,
        history_df: Optional[pd.DataFrame] = None,
    ) -> np.ndarray:
        """Transform one log entry, optionally with recent history for the same user.

        `entry` keys: user, action, details, timestamp (datetime or ISO string).
        `history_df` columns: user, action, timestamp - prior events for the same user.
        """
        row = {
            "user": entry.get("user") or "System",
            "action": entry.get("action") or "UNKNOWN",
            "details": entry.get("details") or "",
            "timestamp": entry.get("timestamp") or datetime.utcnow(),
        }
        df = pd.DataFrame([row])
        if history_df is not None and not history_df.empty:
            hist = history_df.copy()
            hist["details"] = hist.get("details", "")
            df = pd.concat([hist[["user", "action", "details", "timestamp"]], df], ignore_index=True)
        vec = self.transform(df)
        # Last row is the live entry
        return vec[-1:].astype(np.float32)


def save_processed(matrix: np.ndarray, labels: np.ndarray, path: str) -> None:
    np.savez_compressed(path, X=matrix, y=labels)


def load_processed(path: str):
    data = np.load(path, allow_pickle=False)
    return data["X"], data["y"]
