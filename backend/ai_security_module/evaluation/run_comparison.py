"""
run_comparison.py
-----------------
Reproducible entry point for the offline cross-validation comparison.

Steps performed in order:

  1. Build / load the labelled dataset (evaluation/data/dataset.csv).
  2. Run a stratified 80/20 train/test split. The TEST set is set aside
     and never seen during cross-validation.
  3. Stratified K-Fold (k=5, fixed seed) over the TRAINING set. The SAME
     fold indices are reused for every model so the comparison is paired.
     Every fold builds a FRESH Pipeline -- the ColumnTransformer
     (MinMaxScaler + OneHotEncoder) is therefore fit only on that fold's
     training rows, eliminating leakage from validation rows.
  4. For each model, score it on the held-out test set with a single
     fit-on-the-full-training-set / predict-on-test pass.
  5. Persist a CSV + Markdown comparison table, ROC curves overlay, a
     bar chart of mean F1 and ROC-AUC, the best model's confusion matrix,
     and a results.md report.

Usage:
    docker exec hospital_backend python -m ai_security_module.evaluation.run_comparison
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from typing import Dict, List

import numpy as np
import pandas as pd

# matplotlib must be imported with a non-interactive backend BEFORE pyplot.
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from sklearn.metrics import (
    accuracy_score, confusion_matrix, f1_score, precision_score,
    recall_score, roc_auc_score, roc_curve,
)
from sklearn.model_selection import StratifiedKFold, train_test_split

from .generate_dataset import (
    DATASET_PATH, build_dataset, print_summary,
)
from .models import (
    CATEGORICAL_COLS, NUMERIC_COLS, model_factories, prepare_features,
)


# ----------------------------------------------------------------------
# Configuration
# ----------------------------------------------------------------------
RANDOM_STATE = 42
N_SPLITS = 5
TEST_SIZE = 0.20

EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(EVAL_DIR, "results")

METRICS = ["accuracy", "precision", "recall", "f1", "roc_auc"]


def _set_global_seeds(seed: int = RANDOM_STATE) -> None:
    """Set every seed source we touch so the run is fully reproducible."""
    random.seed(seed)
    np.random.seed(seed)
    try:
        import torch
        torch.manual_seed(seed)
        torch.cuda.manual_seed_all(seed)
        torch.use_deterministic_algorithms(False)
    except Exception:
        pass


# ----------------------------------------------------------------------
# Per-fold metric collection
# ----------------------------------------------------------------------
def _evaluate(y_true, y_pred, y_score) -> Dict[str, float]:
    return {
        "accuracy":  accuracy_score(y_true, y_pred),
        "precision": precision_score(y_true, y_pred, zero_division=0),
        "recall":    recall_score(y_true, y_pred, zero_division=0),
        "f1":        f1_score(y_true, y_pred, zero_division=0),
        "roc_auc":   roc_auc_score(y_true, y_score),
    }


def cross_validate_all(
    df: pd.DataFrame,
    factories: Dict[str, callable],
    n_splits: int = N_SPLITS,
    random_state: int = RANDOM_STATE,
) -> pd.DataFrame:
    """Run the same K folds across every model. Returns a long-form
    DataFrame with columns (model, fold, metric, value)."""
    X = df[NUMERIC_COLS + CATEGORICAL_COLS]
    y = df["label"].astype(int).values

    skf = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=random_state)
    fold_indices = list(skf.split(X, y))

    records: List[dict] = []
    for model_name, factory in factories.items():
        print(f"\n[cv] === {model_name} ===")
        for fold_idx, (tr, va) in enumerate(fold_indices, start=1):
            X_tr, X_va = X.iloc[tr], X.iloc[va]
            y_tr, y_va = y[tr], y[va]
            t0 = time.time()
            pipe = factory()
            pipe.fit(X_tr, y_tr)
            y_pred = pipe.predict(X_va)
            y_score = pipe.decision_function(X_va)
            metrics = _evaluate(y_va, y_pred, y_score)
            took = time.time() - t0
            print(
                f"  fold {fold_idx}/{n_splits}  "
                + "  ".join(f"{k}={metrics[k]:.4f}" for k in METRICS)
                + f"  ({took:.1f}s)"
            )
            for k, v in metrics.items():
                records.append({"model": model_name, "fold": fold_idx,
                                "metric": k, "value": v})
    return pd.DataFrame(records)


def aggregate(records_df: pd.DataFrame) -> pd.DataFrame:
    """Mean ± std across folds, wide form (model x metric)."""
    agg = records_df.groupby(["model", "metric"])["value"].agg(["mean", "std"])
    agg.columns = ["mean", "std"]
    pivot = agg.unstack("metric")
    # Re-order metric columns
    pivot = pivot.reindex(columns=pd.MultiIndex.from_product(
        [["mean", "std"], METRICS], names=[None, "metric"]
    ))
    return pivot


# ----------------------------------------------------------------------
# Held-out test evaluation
# ----------------------------------------------------------------------
def holdout_eval(
    df_train: pd.DataFrame,
    df_test: pd.DataFrame,
    factories: Dict[str, callable],
) -> Dict[str, dict]:
    """Fit each model on the full training portion and score the unseen
    test set ONCE. Also returns the ROC curve points + confusion matrix
    for the best model so the report can render them."""
    X_tr = df_train[NUMERIC_COLS + CATEGORICAL_COLS]
    y_tr = df_train["label"].astype(int).values
    X_te = df_test[NUMERIC_COLS + CATEGORICAL_COLS]
    y_te = df_test["label"].astype(int).values

    out: Dict[str, dict] = {}
    for model_name, factory in factories.items():
        print(f"[holdout] fitting {model_name} on full training set...")
        t0 = time.time()
        pipe = factory()
        pipe.fit(X_tr, y_tr)
        y_pred = pipe.predict(X_te)
        y_score = pipe.decision_function(X_te)
        m = _evaluate(y_te, y_pred, y_score)
        fpr, tpr, _ = roc_curve(y_te, y_score)
        out[model_name] = {
            "metrics": m,
            "fpr": fpr.tolist(),
            "tpr": tpr.tolist(),
            "y_pred": y_pred.tolist(),
            "y_score": y_score.tolist(),
            "y_true": y_te.tolist(),
            "took_seconds": time.time() - t0,
        }
        print(
            f"[holdout]   {model_name:<18s} "
            + "  ".join(f"{k}={m[k]:.4f}" for k in METRICS)
            + f"  ({out[model_name]['took_seconds']:.1f}s)"
        )
    return out


# ----------------------------------------------------------------------
# Output rendering
# ----------------------------------------------------------------------
def write_results_table(
    agg: pd.DataFrame, holdout: Dict[str, dict], path_csv: str, path_md: str,
) -> None:
    rows = []
    for model in agg.index:
        row = {"model": model}
        for metric in METRICS:
            mean = agg.loc[model, ("mean", metric)]
            std = agg.loc[model, ("std", metric)]
            row[f"cv_{metric}_mean"] = mean
            row[f"cv_{metric}_std"] = std
            row[f"test_{metric}"] = holdout[model]["metrics"][metric]
        rows.append(row)
    out = pd.DataFrame(rows)
    out.to_csv(path_csv, index=False)

    # Markdown table
    lines = []
    lines.append("# Model comparison\n")
    lines.append("Cross-validation: mean ± std over 5 stratified folds. "
                 "Test: single held-out 20% slice never seen during CV.\n")
    header = ["Model"] + [f"CV {m}" for m in METRICS] + [f"Test {m}" for m in METRICS]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")
    for _, row in out.iterrows():
        cells = [row["model"]]
        for m in METRICS:
            cells.append(f"{row[f'cv_{m}_mean']:.4f} ± {row[f'cv_{m}_std']:.4f}")
        for m in METRICS:
            cells.append(f"{row[f'test_{m}']:.4f}")
        lines.append("| " + " | ".join(cells) + " |")
    with open(path_md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


def plot_roc_curves(holdout: Dict[str, dict], path: str) -> None:
    fig, ax = plt.subplots(figsize=(7, 6))
    for model_name, data in holdout.items():
        auc = data["metrics"]["roc_auc"]
        ax.plot(data["fpr"], data["tpr"], label=f"{model_name} (AUC={auc:.3f})")
    ax.plot([0, 1], [0, 1], "k--", alpha=0.4, label="Chance")
    ax.set_xlabel("False Positive Rate")
    ax.set_ylabel("True Positive Rate")
    ax.set_title("ROC curves on held-out test set")
    ax.legend(loc="lower right")
    ax.grid(True, alpha=0.3)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_metric_bars(agg: pd.DataFrame, path: str) -> None:
    models = list(agg.index)
    f1_means = [agg.loc[m, ("mean", "f1")] for m in models]
    f1_stds = [agg.loc[m, ("std", "f1")] for m in models]
    auc_means = [agg.loc[m, ("mean", "roc_auc")] for m in models]
    auc_stds = [agg.loc[m, ("std", "roc_auc")] for m in models]

    x = np.arange(len(models))
    width = 0.35

    fig, ax = plt.subplots(figsize=(8, 5))
    bars1 = ax.bar(x - width / 2, f1_means, width, yerr=f1_stds,
                   capsize=4, label="F1")
    bars2 = ax.bar(x + width / 2, auc_means, width, yerr=auc_stds,
                   capsize=4, label="ROC-AUC")
    ax.set_xticks(x)
    ax.set_xticklabels(models, rotation=10)
    ax.set_ylim(0, 1.05)
    ax.set_ylabel("Mean across 5 folds")
    ax.set_title("Cross-validated F1 and ROC-AUC (mean ± std)")
    ax.legend()
    ax.grid(True, alpha=0.3, axis="y")
    for bars in (bars1, bars2):
        for b in bars:
            ax.annotate(f"{b.get_height():.3f}",
                        xy=(b.get_x() + b.get_width() / 2, b.get_height()),
                        xytext=(0, 3), textcoords="offset points",
                        ha="center", fontsize=8)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def plot_confusion(best_name: str, data: dict, path: str) -> None:
    cm = confusion_matrix(data["y_true"], data["y_pred"])
    fig, ax = plt.subplots(figsize=(4.5, 4))
    im = ax.imshow(cm, cmap="Blues")
    for (i, j), v in np.ndenumerate(cm):
        ax.text(j, i, str(v), ha="center", va="center",
                color="white" if v > cm.max() / 2 else "black", fontsize=12)
    ax.set_xticks([0, 1]); ax.set_xticklabels(["Normal (0)", "Anomaly (1)"])
    ax.set_yticks([0, 1]); ax.set_yticklabels(["Normal (0)", "Anomaly (1)"])
    ax.set_xlabel("Predicted"); ax.set_ylabel("True")
    ax.set_title(f"Confusion matrix -- {best_name} (held-out test)")
    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    fig.tight_layout()
    fig.savefig(path, dpi=130)
    plt.close(fig)


def write_results_md(
    df: pd.DataFrame, agg: pd.DataFrame, holdout: Dict[str, dict],
    best_name: str, path: str,
) -> None:
    """Long-form report explaining the dataset, the table, and the verdict."""
    n_total = len(df)
    n_normal = int((df["label"] == 0).sum())
    n_anomaly = int((df["label"] == 1).sum())

    cv_md_rows = []
    for model in agg.index:
        cv_md_rows.append({
            "model": model,
            **{f"cv_{m}": f"{agg.loc[model, ('mean', m)]:.4f} ± "
                          f"{agg.loc[model, ('std', m)]:.4f}"
               for m in METRICS},
        })

    test_md_rows = [
        {"model": m, **{f"test_{k}": f"{holdout[m]['metrics'][k]:.4f}"
                        for k in METRICS}}
        for m in holdout.keys()
    ]

    lines: List[str] = []
    lines.append("# Anomaly-detection model comparison\n")
    lines.append(
        "This report is produced by "
        "`ai_security_module.evaluation.run_comparison`. It is offline, "
        "self-contained, and does **not** touch the live FastAPI request "
        "path. Re-running the script regenerates every artifact under "
        "`evaluation/results/` from the same fixed random seed.\n"
    )

    lines.append("## 1. Dataset\n")
    lines.append(
        f"- Source: synthetic generator in `evaluation/generate_dataset.py`, "
        "extending the live module's role/action taxonomy with seven "
        "labeled attack archetypes (off-hours login, outside-consultation "
        "violation, folder-exfiltration burst, role mismatch, weekend "
        "admin activity, mass user deletion, lab-tech folder browsing)."
    )
    lines.append(f"- Total rows: **{n_total}**")
    lines.append(
        f"- Normal (label=0): **{n_normal}** ({100 * n_normal / n_total:.2f}%)"
    )
    lines.append(
        f"- Anomaly (label=1): **{n_anomaly}** "
        f"({100 * n_anomaly / n_total:.2f}%)"
    )
    lines.append(
        "- 60-day timespan; rolling per-user features are computed "
        "backward-in-time only, so engineering them on the full dataset "
        "before the CV split does not leak validation labels.\n"
    )

    lines.append("## 2. Methodology\n")
    lines.append(
        "- 80/20 stratified train/test split. The 20% test set is set "
        "aside and only touched in the held-out final eval."
    )
    lines.append(
        "- Stratified K-Fold (k=5, shuffle, fixed seed) over the 80% "
        "training portion. The same fold indices are reused for every "
        "model so the comparison is paired."
    )
    lines.append(
        "- Inside each fold the ColumnTransformer "
        "(MinMaxScaler + OneHotEncoder) is fit on training rows only; "
        "no scaler ever sees the validation portion."
    )
    lines.append(
        "- The autoencoder + One-Class SVM are fit on NORMAL training "
        "rows only -- faithful to one-class anomaly-detection semantics. "
        "Isolation Forest sees the natural training mix. Random Forest "
        "sees both classes (supervised)."
    )
    lines.append(
        "- The autoencoder uses an inner 15% normal-only validation slice "
        "for early stopping (patience=6), then sets its anomaly threshold "
        "to P95 of training-normal reconstruction errors."
    )
    lines.append(
        "- Anomaly scores are oriented identically across models "
        "(*higher = more anomalous*) so `sklearn.metrics.roc_auc_score` "
        "is directly comparable.\n"
    )

    lines.append("## 3. Cross-validation results (mean ± std over 5 folds)\n")
    header = ["Model"] + [m.upper() for m in METRICS]
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")
    for row in cv_md_rows:
        lines.append("| " + " | ".join(
            [row["model"]] + [row[f"cv_{m}"] for m in METRICS]
        ) + " |")

    lines.append("\n## 4. Held-out test results (single final number per model)\n")
    lines.append("| " + " | ".join(header) + " |")
    lines.append("| " + " | ".join(["---"] * len(header)) + " |")
    for row in test_md_rows:
        lines.append("| " + " | ".join(
            [row["model"]] + [row[f"test_{m}"] for m in METRICS]
        ) + " |")

    best_cv = max(holdout.keys(),
                  key=lambda k: holdout[k]["metrics"]["roc_auc"])
    lines.append(
        f"\n## 5. Winner\n\n"
        f"**{best_cv}** has the highest held-out ROC-AUC "
        f"({holdout[best_cv]['metrics']['roc_auc']:.4f}). The confusion "
        f"matrix for this model on the test set is saved as "
        f"`confusion_matrix.png`.\n"
    )

    lines.append("## 6. Honest caveats\n")
    lines.append(
        "- **The Random Forest sees labels at train time**, so it has a "
        "structural advantage over the three unsupervised detectors. Its "
        "score is therefore an *upper bound* on what is achievable when "
        "the attack distribution at test time matches the one at train "
        "time -- it does **not** generalize to novel attacks the model "
        "has never been labeled on."
    )
    lines.append(
        "- **The unsupervised detectors (Isolation Forest, One-Class SVM, "
        "Autoencoder)** are more realistic for production anomaly detection: "
        "they look for *deviations from normal* without being told what "
        "an attack looks like, so they generalize to attack types that did "
        "not appear in the training data."
    )
    lines.append(
        "- **One-Class SVM** is fit on a random sample of up to 3 000 "
        "normal rows (rbf kernel cost is O(n²) and 12 000 rows takes "
        "several minutes per fold). The subsample is documented in "
        "`models.OneClassSVMEstimator` and is the only practical "
        "shortcut in the harness; the comparison still uses the same "
        "fold indices.\n"
    )

    lines.append("## 7. Integration recommendation\n")
    # Pick the best of the *unsupervised* detectors -- the live integration
    # target, since the live detector layer is explicitly unsupervised.
    unsup = [m for m in holdout if m != "RandomForest"]
    best_unsup = max(unsup,
                     key=lambda k: holdout[k]["metrics"]["roc_auc"])
    lines.append(
        f"The live detector layer in `app/security/detection/` is "
        f"deliberately unsupervised so it can flag *unknown* attacks, "
        f"not just the ones we already have labels for. Among the three "
        f"unsupervised models, **{best_unsup}** wins on held-out ROC-AUC "
        f"({holdout[best_unsup]['metrics']['roc_auc']:.4f}). It is the "
        f"natural next candidate to swap in via the existing detector "
        f"adapter (the live classifier already merges any continuous "
        f"anomaly score with the rule engine, so plugging "
        f"{best_unsup}'s score in place of the current autoencoder's "
        f"reconstruction error would not require any change to the "
        f"hybrid contract). The Random Forest's higher score is "
        f"informative as a labeled-supervised upper bound but is not "
        f"the right fit for the production path.\n"
    )

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))


# ----------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------
def main(force_regenerate: bool = False) -> int:
    _set_global_seeds(RANDOM_STATE)
    os.makedirs(RESULTS_DIR, exist_ok=True)

    # 1. dataset
    if force_regenerate or not os.path.exists(DATASET_PATH):
        print(f"[run] generating dataset -> {DATASET_PATH}")
        raw = build_dataset(seed=RANDOM_STATE)
    else:
        print(f"[run] loading existing dataset <- {DATASET_PATH}")
        raw = pd.read_csv(DATASET_PATH)
    print_summary(raw)

    # 2. feature engineering (ONCE -- rolling features are backward-only)
    print("[run] preparing features...")
    feats = prepare_features(raw)
    print(f"[run] feature matrix: {len(feats)} rows, "
          f"{len(NUMERIC_COLS)} numerics + {len(CATEGORICAL_COLS)} categoricals.")

    # 3. train / test split (stratified, fixed seed)
    train_df, test_df = train_test_split(
        feats, test_size=TEST_SIZE,
        stratify=feats["label"], random_state=RANDOM_STATE,
    )
    print(f"[run] train rows: {len(train_df)}   test rows: {len(test_df)}")

    factories = model_factories(random_state=RANDOM_STATE)

    # 4. cross-validation on training portion
    print("\n[run] === cross-validation (5 stratified folds) ===")
    cv_records = cross_validate_all(train_df, factories,
                                    n_splits=N_SPLITS, random_state=RANDOM_STATE)
    agg = aggregate(cv_records)

    # 5. held-out test eval
    print("\n[run] === held-out test set (final unbiased score) ===")
    holdout = holdout_eval(train_df, test_df, factories)

    # 6. outputs
    print("\n[run] === writing outputs ===")
    write_results_table(
        agg, holdout,
        path_csv=os.path.join(RESULTS_DIR, "results_table.csv"),
        path_md=os.path.join(RESULTS_DIR, "results_table.md"),
    )
    plot_roc_curves(holdout, os.path.join(RESULTS_DIR, "roc_curves.png"))
    plot_metric_bars(agg, os.path.join(RESULTS_DIR, "metric_bars.png"))
    best_name = max(holdout.keys(),
                    key=lambda k: holdout[k]["metrics"]["roc_auc"])
    plot_confusion(best_name, holdout[best_name],
                   os.path.join(RESULTS_DIR, "confusion_matrix.png"))
    write_results_md(
        feats, agg, holdout, best_name,
        path=os.path.join(RESULTS_DIR, "results.md"),
    )

    # 7. terminal summary
    print("\n[run] === SUMMARY (mean over 5 CV folds | held-out test) ===")
    header = f"{'model':<18}" + "".join(f"{m:>14}" for m in METRICS) + "  | test_f1  test_auc"
    print(header)
    print("-" * len(header))
    for model in agg.index:
        cv_cells = "".join(
            f"{agg.loc[model, ('mean', m)]:>7.4f}±{agg.loc[model, ('std', m)]:<.3f}"
            for m in METRICS
        )
        t_f1 = holdout[model]["metrics"]["f1"]
        t_auc = holdout[model]["metrics"]["roc_auc"]
        print(f"{model:<18}{cv_cells}  | {t_f1:>7.4f}  {t_auc:>7.4f}")
    print(f"\n[run] outputs -> {RESULTS_DIR}")
    print(f"[run] winner (held-out ROC-AUC): {best_name}")
    return 0


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--regenerate", action="store_true",
                   help="force re-generation of the dataset CSV")
    return p.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    try:
        sys.exit(main(force_regenerate=args.regenerate))
    except KeyboardInterrupt:
        print("\n[run] interrupted by user")
        sys.exit(130)
