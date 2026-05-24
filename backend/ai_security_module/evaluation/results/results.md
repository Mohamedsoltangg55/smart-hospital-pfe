# Anomaly-detection model comparison

This report is produced by `ai_security_module.evaluation.run_comparison`. It is offline, self-contained, and does **not** touch the live FastAPI request path. Re-running the script regenerates every artifact under `evaluation/results/` from the same fixed random seed.

## 1. Dataset

- Source: synthetic generator in `evaluation/generate_dataset.py`, extending the live module's role/action taxonomy with seven labeled attack archetypes (off-hours login, outside-consultation violation, folder-exfiltration burst, role mismatch, weekend admin activity, mass user deletion, lab-tech folder browsing).
- Total rows: **15000**
- Normal (label=0): **12000** (80.00%)
- Anomaly (label=1): **3000** (20.00%)
- 60-day timespan; rolling per-user features are computed backward-in-time only, so engineering them on the full dataset before the CV split does not leak validation labels.

## 2. Methodology

- 80/20 stratified train/test split. The 20% test set is set aside and only touched in the held-out final eval.
- Stratified K-Fold (k=5, shuffle, fixed seed) over the 80% training portion. The same fold indices are reused for every model so the comparison is paired.
- Inside each fold the ColumnTransformer (MinMaxScaler + OneHotEncoder) is fit on training rows only; no scaler ever sees the validation portion.
- The autoencoder + One-Class SVM are fit on NORMAL training rows only -- faithful to one-class anomaly-detection semantics. Isolation Forest sees the natural training mix. Random Forest sees both classes (supervised).
- The autoencoder uses an inner 15% normal-only validation slice for early stopping (patience=6), then sets its anomaly threshold to P95 of training-normal reconstruction errors.
- Anomaly scores are oriented identically across models (*higher = more anomalous*) so `sklearn.metrics.roc_auc_score` is directly comparable.

## 3. Cross-validation results (mean ± std over 5 folds)

| Model | ACCURACY | PRECISION | RECALL | F1 | ROC_AUC |
| --- | --- | --- | --- | --- | --- |
| Autoencoder | 0.9163 ± 0.0195 | 0.7965 ± 0.0340 | 0.7800 ± 0.0897 | 0.7867 ± 0.0574 | 0.9387 ± 0.0066 |
| IsolationForest | 0.8419 ± 0.0086 | 0.6038 ± 0.0261 | 0.6133 ± 0.0136 | 0.6083 ± 0.0153 | 0.8703 ± 0.0156 |
| OneClassSVM | 0.8178 ± 0.0082 | 0.5252 ± 0.0121 | 0.9383 ± 0.0073 | 0.6734 ± 0.0101 | 0.9701 ± 0.0019 |
| RandomForest | 0.9923 ± 0.0016 | 0.9813 ± 0.0058 | 0.9804 ± 0.0092 | 0.9808 ± 0.0041 | 0.9985 ± 0.0008 |

## 4. Held-out test results (single final number per model)

| Model | ACCURACY | PRECISION | RECALL | F1 | ROC_AUC |
| --- | --- | --- | --- | --- | --- |
| IsolationForest | 0.8257 | 0.5630 | 0.5733 | 0.5681 | 0.8544 |
| OneClassSVM | 0.8183 | 0.5253 | 0.9533 | 0.6773 | 0.9728 |
| RandomForest | 0.9940 | 0.9866 | 0.9833 | 0.9850 | 0.9976 |
| Autoencoder | 0.9297 | 0.7988 | 0.8667 | 0.8313 | 0.9459 |

## 5. Winner

**RandomForest** has the highest held-out ROC-AUC (0.9976). The confusion matrix for this model on the test set is saved as `confusion_matrix.png`.

## 6. Honest caveats

- **The Random Forest sees labels at train time**, so it has a structural advantage over the three unsupervised detectors. Its score is therefore an *upper bound* on what is achievable when the attack distribution at test time matches the one at train time -- it does **not** generalize to novel attacks the model has never been labeled on.
- **The unsupervised detectors (Isolation Forest, One-Class SVM, Autoencoder)** are more realistic for production anomaly detection: they look for *deviations from normal* without being told what an attack looks like, so they generalize to attack types that did not appear in the training data.
- **One-Class SVM** is fit on a random sample of up to 3 000 normal rows (rbf kernel cost is O(n²) and 12 000 rows takes several minutes per fold). The subsample is documented in `models.OneClassSVMEstimator` and is the only practical shortcut in the harness; the comparison still uses the same fold indices.

## 7. Integration recommendation

The live detector layer in `app/security/detection/` is deliberately unsupervised so it can flag *unknown* attacks, not just the ones we already have labels for. Among the three unsupervised models, **OneClassSVM** wins on held-out ROC-AUC (0.9728). It is the natural next candidate to swap in via the existing detector adapter (the live classifier already merges any continuous anomaly score with the rule engine, so plugging OneClassSVM's score in place of the current autoencoder's reconstruction error would not require any change to the hybrid contract). The Random Forest's higher score is informative as a labeled-supervised upper bound but is not the right fit for the production path.
