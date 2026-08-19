"""
train.py
--------
Trains the Autoencoder ONLY on normal (legitimate) audit-log traffic, then
calibrates a reconstruction-error threshold using the 99th-percentile of
validation reconstruction errors (configurable in config.py).

Artifacts written to ai_security_module/artifacts/:
    - autoencoder.pth      : torch state_dict + model metadata
    - preprocessor.joblib  : fitted Preprocessor (scaler + encoders)
    - threshold.json       : {threshold, percentile, input_dim, ...}

Usage:
    python -m ai_security_module.train
"""
from __future__ import annotations

import json
import sys
import time
from typing import Tuple

import joblib
import numpy as np
import pandas as pd
import torch
from torch import nn, optim
from torch.utils.data import DataLoader, TensorDataset

from .config import (
    BATCH_SIZE,
    DEFAULT_SEED,
    EARLY_STOP_PATIENCE,
    EPOCHS,
    LEARNING_RATE,
    MODEL_PATH,
    PREPROCESSOR_PATH,
    RAW_DATA_PATH,
    THRESHOLD_PATH,
    THRESHOLD_PERCENTILE,
    VAL_SPLIT,
    ensure_dirs,
)
from .model import build_model
from .preprocess import Preprocessor


def _set_seed(seed: int) -> None:
    np.random.seed(seed)
    torch.manual_seed(seed)


def _load_raw(path: str = RAW_DATA_PATH) -> pd.DataFrame:
    df = pd.read_csv(path)
    if "label" not in df.columns:
        df["label"] = "normal"
    return df


def _split_normal(df: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (normal_df, anomaly_df). Training uses only normal_df."""
    normal = df[df["label"] == "normal"].reset_index(drop=True)
    anomaly = df[df["label"] != "normal"].reset_index(drop=True)
    return normal, anomaly


def _train_loop(model, train_loader, val_loader, device) -> dict:
    optimizer = optim.Adam(model.parameters(), lr=LEARNING_RATE)
    loss_fn = nn.MSELoss()
    best_val = float("inf")
    best_state = None
    patience = 0
    history = {"train_loss": [], "val_loss": []}

    for epoch in range(1, EPOCHS + 1):
        model.train()
        train_running = 0.0
        train_n = 0
        for (batch,) in train_loader:
            batch = batch.to(device)
            optimizer.zero_grad()
            recon = model(batch)
            loss = loss_fn(recon, batch)
            loss.backward()
            optimizer.step()
            train_running += loss.item() * batch.size(0)
            train_n += batch.size(0)
        train_loss = train_running / max(train_n, 1)

        model.eval()
        val_running = 0.0
        val_n = 0
        with torch.no_grad():
            for (batch,) in val_loader:
                batch = batch.to(device)
                recon = model(batch)
                loss = loss_fn(recon, batch)
                val_running += loss.item() * batch.size(0)
                val_n += batch.size(0)
        val_loss = val_running / max(val_n, 1)

        history["train_loss"].append(train_loss)
        history["val_loss"].append(val_loss)
        print(f"[train] epoch {epoch:03d}/{EPOCHS}  train={train_loss:.6f}  val={val_loss:.6f}")

        if val_loss < best_val - 1e-6:
            best_val = val_loss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            patience = 0
        else:
            patience += 1
            if patience >= EARLY_STOP_PATIENCE:
                print(f"[train] Early stopping at epoch {epoch} (best val={best_val:.6f})")
                break

    if best_state is not None:
        model.load_state_dict(best_state)
    return history


def _compute_threshold(model, val_tensor: torch.Tensor, device) -> Tuple[float, np.ndarray]:
    model.eval()
    with torch.no_grad():
        errors = model.reconstruction_error(val_tensor.to(device)).cpu().numpy()
    threshold = float(np.percentile(errors, THRESHOLD_PERCENTILE))
    return threshold, errors


def _report_anomaly_separation(model, anomaly_matrix: np.ndarray, threshold: float, device) -> dict:
    if len(anomaly_matrix) == 0:
        return {"anomaly_samples": 0, "anomaly_detection_rate": None,
                "anomaly_error_mean": None, "anomaly_error_median": None}
    t = torch.from_numpy(anomaly_matrix.astype(np.float32))
    with torch.no_grad():
        err = model.reconstruction_error(t.to(device)).cpu().numpy()
    detected = float((err > threshold).mean())
    return {
        "anomaly_samples": int(len(err)),
        "anomaly_detection_rate": round(detected, 4),
        "anomaly_error_mean": float(np.mean(err)),
        "anomaly_error_median": float(np.median(err)),
    }


def train(raw_path: str = RAW_DATA_PATH, seed: int = DEFAULT_SEED) -> dict:
    ensure_dirs()
    _set_seed(seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"[train] Device: {device}")

    print(f"[train] Loading raw dataset: {raw_path}")
    df = _load_raw(raw_path)
    normal_df, anomaly_df = _split_normal(df)
    print(f"[train] Normal rows: {len(normal_df)} | Anomaly rows: {len(anomaly_df)}")

    if len(normal_df) < 200:
        raise RuntimeError(f"Not enough normal samples to train ({len(normal_df)}). "
                           f"Run data_fetcher first.")

    # Fit preprocessor on the full dataset so encoders see every category,
    # then transform only the normal subset for training.
    preprocessor = Preprocessor().fit(df)
    X_normal = preprocessor.transform(normal_df)
    X_anomaly = preprocessor.transform(anomaly_df) if len(anomaly_df) else np.zeros((0, preprocessor.n_features), dtype=np.float32)

    # Train/val split on normal traffic only
    rng = np.random.default_rng(seed)
    idx = np.arange(len(X_normal))
    rng.shuffle(idx)
    cut = int(len(idx) * (1.0 - VAL_SPLIT))
    train_idx, val_idx = idx[:cut], idx[cut:]
    X_train = X_normal[train_idx]
    X_val = X_normal[val_idx]
    print(f"[train] Shapes  train={X_train.shape}  val={X_val.shape}  input_dim={preprocessor.n_features}")

    train_tensor = torch.from_numpy(X_train.astype(np.float32))
    val_tensor = torch.from_numpy(X_val.astype(np.float32))

    train_loader = DataLoader(TensorDataset(train_tensor),
                              batch_size=BATCH_SIZE, shuffle=True)
    val_loader = DataLoader(TensorDataset(val_tensor),
                            batch_size=BATCH_SIZE, shuffle=False)

    model = build_model(input_dim=preprocessor.n_features).to(device)
    print(f"[train] Model:\n{model}")

    t0 = time.time()
    history = _train_loop(model, train_loader, val_loader, device)
    print(f"[train] Training finished in {time.time()-t0:.1f}s")

    threshold, val_errors = _compute_threshold(model, val_tensor, device)
    anomaly_metrics = _report_anomaly_separation(model, X_anomaly, threshold, device)
    print(f"[train] Threshold (P{THRESHOLD_PERCENTILE} of val errors) = {threshold:.6f}")
    print(f"[train] Anomaly evaluation: {anomaly_metrics}")

    # Persist artifacts
    torch.save({
        "state_dict": model.state_dict(),
        "input_dim": preprocessor.n_features,
    }, MODEL_PATH)
    joblib.dump(preprocessor, PREPROCESSOR_PATH)
    metadata = {
        "threshold": threshold,
        "percentile": THRESHOLD_PERCENTILE,
        "input_dim": preprocessor.n_features,
        "feature_names": preprocessor.feature_names,
        "val_error_min": float(np.min(val_errors)),
        "val_error_max": float(np.max(val_errors)),
        "val_error_mean": float(np.mean(val_errors)),
        # Phase 1: percentile anchors of normal-traffic reconstruction error.
        # The detection layer uses these to normalize a raw score to 0-1 and
        # to derive the NORMAL / SUSPICIOUS / CRITICAL tiers.
        "score_anchors": {
            "min": float(np.min(val_errors)),
            "p50": float(np.percentile(val_errors, 50)),
            "p90": float(np.percentile(val_errors, 90)),
            "p95": float(np.percentile(val_errors, 95)),
            "p98": float(np.percentile(val_errors, 98)),
            "p99": float(np.percentile(val_errors, 99)),
            "max": float(np.max(val_errors)),
        },
        "anomaly_eval": anomaly_metrics,
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    with open(THRESHOLD_PATH, "w", encoding="utf-8") as f:
        json.dump(metadata, f, indent=2)

    print(f"[train] Saved model       -> {MODEL_PATH}")
    print(f"[train] Saved preprocessor -> {PREPROCESSOR_PATH}")
    print(f"[train] Saved threshold    -> {THRESHOLD_PATH}")
    return metadata


if __name__ == "__main__":
    try:
        train()
    except Exception as e:
        print(f"[train] FATAL: {e}", file=sys.stderr)
        sys.exit(1)
