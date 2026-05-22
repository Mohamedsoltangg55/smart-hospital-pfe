# Security module — architecture

This package powers the Security Audit Logs intelligence of the Smart Hospital
dashboard. It is split into **two physically separate layers, on purpose**:

| Layer | Package | Role | Decides? |
|-------|---------|------|----------|
| **Detection** | `detection/` | Flags anomalies; assigns score + status | ✅ Yes |
| **Explanation** | `analysis/` *(later phase)* | LLM contextual analysis of an already-flagged event | ❌ No |

The LLM **never** computes or changes a score or a status. It only explains an
event the detection layer has already flagged. This separation is deliberate
and is the defensible core of the design — keep it intact.

## Detection layer — a hybrid detector

`detection/classifier.classify()` is the **single source of truth** for an
event's status. It merges two signals; the higher status wins, and neither
signal can ever *lower* a status:

### 1. Rule engine — PRIMARY signal (`rule_engine.py`)

Deterministic, no training, high precision. Current rules:

| Rule | Fires when |
|------|-----------|
| `SECURITY_VIOLATION` | action is `SECURITY_VIOLATION` (always ≥ SUSPICIOUS) |
| `ACCESS_OUTSIDE_CONSULTATION` | event details mention access "outside consultation" |
| `OFF_HOURS_LOGIN` | a `USER_LOGIN` outside office hours |
| `REPEATED_ACTIONS_BURST` | many actions by one operator in a short window |
| `ROLE_RESOURCE_MISMATCH` | a role performing actions outside its mandate |

### 2. Autoencoder — SECONDARY "unknown pattern" signal

A PyTorch autoencoder (`ai_security_module/`) produces a raw reconstruction
error. `score_normalizer.py` maps it to a 0–1 percentile rank, and `config.py`
cutoffs turn that into a tier (p90 → SUSPICIOUS, p98 → CRITICAL). It exists to
catch patterns no rule covers — it is **not** the trusted signal today.

All cutoffs, rule parameters and the anchor source live in `config.py`
(env-overridable) — **no magic numbers** elsewhere.

## Score normalization anchors

`config.ANCHOR_SOURCE` selects where the normalization anchors come from:

- `real` *(default)* — `anchors.json`, recomputed from **real benign audit
  logs** by `calibration.py`.
- `synthetic` — the autoencoder's own `threshold.json["score_anchors"]`.

Regenerate the real anchors after accumulating more logs:

```
python -m app.security.detection.calibration   # writes anchors.json
python -m app.security.detection.backfill       # re-classify existing rows
```

## Limitations & Future Work

- **The autoencoder is trained on synthetic data.** It over-scores real
  traffic — real events land above the entire synthetic-normal range — and has
  weak benign/malicious discrimination (~64% detection on synthetic anomalies).
- **The rule engine carries precision today.** It is the trustworthy signal;
  the autoencoder is a secondary net for the unknown.
- **`anchors.json` is an interim stop-gap.** It is recalibrated from a small
  number of real rows, so its high percentiles (p98/p99) are statistically
  thin. It keeps the dashboard from reading all-CRITICAL; it is not a fix.
- **Plan:** accumulate real audit logs through normal production use, then
  retrain the autoencoder on them (`python -m ai_security_module.run_initial_setup`).
  `train.py` already auto-recomputes percentile anchors, so a real-data retrain
  fixes the over-scoring at the source and `anchors.json` can be retired.
