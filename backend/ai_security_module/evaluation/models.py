"""
models.py
---------
Four anomaly-detection models wrapped behind a common scikit-learn-compatible
interface so the cross-validation harness can run all of them through one
Pipeline contract.

Every estimator in this module exposes:
    fit(X, y)               -> self
    predict(X)              -> ndarray of shape (n,) with values in {0, 1}
    decision_function(X)    -> ndarray of shape (n,), HIGHER = MORE ANOMALOUS

The "higher = more anomalous" convention is enforced uniformly here so the
CV harness can pass these scores straight to sklearn.metrics.roc_auc_score
without flipping signs per model.

Feature pipeline:
    raw audit rows -> prepare_features() -> a DataFrame with
        numeric columns (cyclic time, off-hours / weekend flags, details
        length, rolling per-user behaviour counts) +
        categorical columns (action, user_bucket) +
        the label column (0/1).
    Inside every CV fold, a fresh ColumnTransformer scales the numerics
    and one-hot-encodes the categoricals; it is fit ONLY on the training
    portion of the fold so there is no leakage from validation rows.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import IsolationForest, RandomForestClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import MinMaxScaler, OneHotEncoder
from sklearn.svm import OneClassSVM

# ----------------------------------------------------------------------
# Feature engineering
# ----------------------------------------------------------------------
NUMERIC_COLS: List[str] = [
    "hour_sin", "hour_cos", "dow_sin", "dow_cos",
    "is_off_hours", "is_weekend", "details_length",
    "actions_last_hour", "actions_last_5min",
    "distinct_actions_last_hour", "seconds_since_user_last",
]
CATEGORICAL_COLS: List[str] = ["action", "user_bucket"]

ROLLING_WINDOW_MINUTES = 60
RAPID_BURST_WINDOW_MINUTES = 5


def _user_bucket(username: str) -> str:
    """Coarse role inference from username prefix."""
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


def _compute_rolling(df: pd.DataFrame) -> pd.DataFrame:
    """Per-user backward-looking counts. Only looks BACKWARD in time so
    computing this on the full dataset before the CV split does not leak
    validation labels into training features."""
    df = df.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"], errors="coerce")
    df = df.sort_values("timestamp").reset_index(drop=True)

    win_hour = timedelta(minutes=ROLLING_WINDOW_MINUTES)
    win_burst = timedelta(minutes=RAPID_BURST_WINDOW_MINUTES)

    history: Dict[str, List[Tuple[pd.Timestamp, str]]] = {}
    h, b, d_uniq, sec = [], [], [], []

    for _, row in df.iterrows():
        u = row["user"] if isinstance(row["user"], str) else "System"
        ts = row["timestamp"]
        if pd.isna(ts):
            ts = pd.Timestamp(datetime.utcnow())

        hist = history.setdefault(u, [])
        cutoff = ts - win_hour
        while hist and hist[0][0] < cutoff:
            hist.pop(0)

        within_burst = [item for item in hist if item[0] >= ts - win_burst]
        h.append(len(hist))
        b.append(len(within_burst))
        d_uniq.append(len({a for _, a in hist}))
        sec.append(min((ts - hist[-1][0]).total_seconds(), 86400.0) if hist else 86400.0)

        hist.append((ts, row.get("action") or "UNKNOWN"))

    df["actions_last_hour"] = h
    df["actions_last_5min"] = b
    df["distinct_actions_last_hour"] = d_uniq
    df["seconds_since_user_last"] = sec
    return df


def prepare_features(raw: pd.DataFrame) -> pd.DataFrame:
    """Turn raw audit rows (user, action, details, timestamp, label) into
    a feature DataFrame with NUMERIC_COLS + CATEGORICAL_COLS + 'label'."""
    df = _compute_rolling(raw)
    ts = df["timestamp"]
    hour = ts.dt.hour.fillna(12).astype(int)
    dow = ts.dt.dayofweek.fillna(0).astype(int)

    df["hour_sin"] = np.sin(2 * np.pi * hour / 24.0)
    df["hour_cos"] = np.cos(2 * np.pi * hour / 24.0)
    df["dow_sin"] = np.sin(2 * np.pi * dow / 7.0)
    df["dow_cos"] = np.cos(2 * np.pi * dow / 7.0)
    df["is_off_hours"] = ((hour < 7) | (hour > 20)).astype(int)
    df["is_weekend"] = (dow >= 5).astype(int)
    df["details_length"] = df["details"].fillna("").astype(str).str.len().clip(upper=500)
    df["user_bucket"] = df["user"].apply(_user_bucket)
    df["action"] = df["action"].fillna("UNKNOWN").astype(str)

    keep = NUMERIC_COLS + CATEGORICAL_COLS + ["label"]
    return df[keep].reset_index(drop=True)


def build_preprocessor() -> ColumnTransformer:
    """Fresh ColumnTransformer: MinMaxScaler for numerics, OneHotEncoder for
    categoricals. Returned per-fold so the fit is bounded to that fold's
    training rows."""
    try:
        ohe = OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:  # sklearn < 1.2 fallback
        ohe = OneHotEncoder(handle_unknown="ignore", sparse=False)
    return ColumnTransformer([
        ("num", MinMaxScaler(), NUMERIC_COLS),
        ("cat", ohe, CATEGORICAL_COLS),
    ])


# ----------------------------------------------------------------------
# Model wrappers -- common interface
# ----------------------------------------------------------------------
class IsolationForestEstimator(BaseEstimator, ClassifierMixin):
    """IsolationForest with the standard 'higher = more anomalous' contract."""

    def __init__(self, n_estimators: int = 200, contamination: float = 0.2,
                 random_state: int = 42):
        self.n_estimators = n_estimators
        self.contamination = contamination
        self.random_state = random_state

    def fit(self, X, y=None):
        self.clf_ = IsolationForest(
            n_estimators=self.n_estimators,
            contamination=self.contamination,
            random_state=self.random_state,
            n_jobs=-1,
        )
        self.clf_.fit(X)
        return self

    def decision_function(self, X):
        # IsolationForest.score_samples: higher = more normal -> flip sign.
        return -self.clf_.score_samples(X)

    def predict(self, X):
        # IsolationForest.predict: 1 = inlier, -1 = outlier -> map to 0/1.
        return (self.clf_.predict(X) == -1).astype(int)


class OneClassSVMEstimator(BaseEstimator, ClassifierMixin):
    """One-class SVM. By design fits on NORMAL rows only. We subsample the
    normal training rows to keep the rbf-kernel fit time bounded -- noted
    in results.md as the only model that pays this practical cost."""

    def __init__(self, kernel: str = "rbf", gamma: str = "scale",
                 nu: float = 0.2, max_normal_samples: int = 3000,
                 random_state: int = 42):
        self.kernel = kernel
        self.gamma = gamma
        self.nu = nu
        self.max_normal_samples = max_normal_samples
        self.random_state = random_state

    def fit(self, X, y=None):
        if y is None:
            X_norm = X
        else:
            mask = (np.asarray(y) == 0)
            X_norm = X[mask] if isinstance(X, np.ndarray) else np.asarray(X)[mask]
        n = X_norm.shape[0]
        if n > self.max_normal_samples:
            rng = np.random.RandomState(self.random_state)
            idx = rng.choice(n, size=self.max_normal_samples, replace=False)
            X_norm = X_norm[idx]
        self.clf_ = OneClassSVM(kernel=self.kernel, gamma=self.gamma, nu=self.nu)
        self.clf_.fit(X_norm)
        return self

    def decision_function(self, X):
        # OneClassSVM.decision_function: positive = inside boundary
        # (=more normal) -> flip sign.
        return -self.clf_.decision_function(X)

    def predict(self, X):
        return (self.clf_.predict(X) == -1).astype(int)


class RandomForestEstimator(BaseEstimator, ClassifierMixin):
    """Supervised baseline. Uses both classes at train time -- noted in
    results.md as having an unfair advantage over the unsupervised
    detectors when the attack archetypes seen at train time match the
    ones at test time."""

    def __init__(self, n_estimators: int = 200, max_depth: int = None,
                 class_weight: str = "balanced", random_state: int = 42):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.class_weight = class_weight
        self.random_state = random_state

    def fit(self, X, y):
        self.clf_ = RandomForestClassifier(
            n_estimators=self.n_estimators,
            max_depth=self.max_depth,
            class_weight=self.class_weight,
            random_state=self.random_state,
            n_jobs=-1,
        )
        self.clf_.fit(X, y)
        return self

    def decision_function(self, X):
        # P(y=1) directly = "higher = more anomalous".
        return self.clf_.predict_proba(X)[:, 1]

    def predict(self, X):
        return self.clf_.predict(X).astype(int)


class AutoencoderEstimator(BaseEstimator, ClassifierMixin):
    """PyTorch autoencoder wrapped to look like a sklearn classifier.

    Training pipeline:
      * Subset to NORMAL rows (y == 0) -- one-class semantics.
      * Hold out an inner 15% validation slice for early stopping.
      * Train MSE for up to `epochs` with patience `early_stop_patience`.
      * Compute the P95 of training-normal reconstruction errors; that
        becomes the threshold for predict().

    Anomaly score = MSE between the input and its reconstruction. Higher
    error means the autoencoder couldn't recover the input from the
    bottleneck -- the standard "anomaly = bad reconstruction" signal.
    """

    def __init__(self, hidden_dims=(32, 16), bottleneck: int = 8,
                 dropout: float = 0.1, epochs: int = 60,
                 batch_size: int = 256, learning_rate: float = 1e-3,
                 early_stop_patience: int = 6, val_split: float = 0.15,
                 threshold_percentile: float = 95.0,
                 random_state: int = 42, verbose: bool = False):
        self.hidden_dims = hidden_dims
        self.bottleneck = bottleneck
        self.dropout = dropout
        self.epochs = epochs
        self.batch_size = batch_size
        self.learning_rate = learning_rate
        self.early_stop_patience = early_stop_patience
        self.val_split = val_split
        self.threshold_percentile = threshold_percentile
        self.random_state = random_state
        self.verbose = verbose

    # PyTorch is imported lazily so a plain `import models` is cheap.
    def _build_model(self, input_dim: int):
        import torch
        from torch import nn

        class _AE(nn.Module):
            def __init__(self, dim, hidden_dims, bottleneck, dropout):
                super().__init__()
                enc, prev = [], dim
                for h in hidden_dims:
                    enc += [nn.Linear(prev, h), nn.LeakyReLU(0.1), nn.Dropout(dropout)]
                    prev = h
                enc += [nn.Linear(prev, bottleneck), nn.LeakyReLU(0.1)]
                self.encoder = nn.Sequential(*enc)
                dec, prev = [], bottleneck
                for h in reversed(hidden_dims):
                    dec += [nn.Linear(prev, h), nn.LeakyReLU(0.1), nn.Dropout(dropout)]
                    prev = h
                dec += [nn.Linear(prev, dim)]
                self.decoder = nn.Sequential(*dec)

            def forward(self, x):
                return self.decoder(self.encoder(x))

        return _AE(input_dim, list(self.hidden_dims), self.bottleneck, self.dropout)

    def fit(self, X, y):
        import torch
        from torch import nn
        from torch.utils.data import DataLoader, TensorDataset

        torch.manual_seed(self.random_state)
        np.random.seed(self.random_state)

        X = np.asarray(X, dtype=np.float32)
        y = np.asarray(y).astype(int)
        normal = X[y == 0]
        if len(normal) < 20:
            raise RuntimeError("AutoencoderEstimator: not enough NORMAL rows to fit.")

        # Inner validation split (normal-only) for early stopping.
        rng = np.random.RandomState(self.random_state)
        idx = rng.permutation(len(normal))
        n_val = max(1, int(len(normal) * self.val_split))
        val_idx, tr_idx = idx[:n_val], idx[n_val:]
        X_tr = torch.from_numpy(normal[tr_idx])
        X_val = torch.from_numpy(normal[val_idx])

        model = self._build_model(X.shape[1])
        opt = torch.optim.Adam(model.parameters(), lr=self.learning_rate)
        loss_fn = nn.MSELoss()

        loader = DataLoader(
            TensorDataset(X_tr), batch_size=self.batch_size, shuffle=True,
            generator=torch.Generator().manual_seed(self.random_state),
        )

        best_val = float("inf")
        best_state = None
        stale = 0
        for epoch in range(1, self.epochs + 1):
            model.train()
            for (batch,) in loader:
                opt.zero_grad()
                recon = model(batch)
                loss = loss_fn(recon, batch)
                loss.backward()
                opt.step()
            model.eval()
            with torch.no_grad():
                val_recon = model(X_val)
                val_loss = loss_fn(val_recon, X_val).item()
            if self.verbose:
                print(f"  [ae] epoch {epoch:3d} val={val_loss:.6f}")
            if val_loss + 1e-7 < best_val:
                best_val = val_loss
                best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
                stale = 0
            else:
                stale += 1
                if stale >= self.early_stop_patience:
                    if self.verbose:
                        print(f"  [ae] early stop @ epoch {epoch}")
                    break

        if best_state is not None:
            model.load_state_dict(best_state)
        self.model_ = model
        self.input_dim_ = X.shape[1]

        # Threshold = P{threshold_percentile} of training-normal recon errors.
        with torch.no_grad():
            tr_errors = self._mse(model, torch.from_numpy(normal))
        self.threshold_ = float(np.percentile(tr_errors, self.threshold_percentile))
        return self

    @staticmethod
    def _mse(model, X_tensor) -> np.ndarray:
        import torch
        model.eval()
        with torch.no_grad():
            recon = model(X_tensor)
            err = torch.mean((X_tensor - recon) ** 2, dim=1).cpu().numpy()
        return err.astype(np.float64)

    def decision_function(self, X):
        import torch
        X = np.asarray(X, dtype=np.float32)
        return self._mse(self.model_, torch.from_numpy(X))

    def predict(self, X):
        return (self.decision_function(X) > self.threshold_).astype(int)


# ----------------------------------------------------------------------
# Pipeline factories -- one fresh Pipeline per CV fold
# ----------------------------------------------------------------------
def make_pipeline(model: BaseEstimator) -> Pipeline:
    return Pipeline([("prep", build_preprocessor()), ("clf", model)])


def model_factories(random_state: int = 42) -> Dict[str, callable]:
    """Returns a dict {model_name -> () -> Pipeline}.

    Calling the factory builds a *fresh* Pipeline + estimator so each CV
    fold gets its own untrained instance.
    """
    return {
        "IsolationForest":  lambda: make_pipeline(IsolationForestEstimator(random_state=random_state)),
        "OneClassSVM":      lambda: make_pipeline(OneClassSVMEstimator(random_state=random_state)),
        "RandomForest":     lambda: make_pipeline(RandomForestEstimator(random_state=random_state)),
        "Autoencoder":      lambda: make_pipeline(AutoencoderEstimator(random_state=random_state)),
    }
