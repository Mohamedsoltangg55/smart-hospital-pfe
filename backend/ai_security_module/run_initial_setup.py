"""
run_initial_setup.py
--------------------
Master controller. One command takes us from zero -> trained model:

    python -m ai_security_module.run_initial_setup

Pipeline:
    1. Fetch / generate baseline dataset  (data_fetcher.fetch_dataset)
    2. Train Autoencoder + calibrate threshold  (train.train)
    3. Warm the inference cache + sanity check  (predict.check_live_log)
"""
from __future__ import annotations

import sys
from datetime import datetime

from .config import ensure_dirs
from .data_fetcher import fetch_dataset
from .predict import check_live_log, reset_cache
from .train import train


def main() -> int:
    ensure_dirs()
    print("=" * 70)
    print("  AI SECURITY MODULE - INITIAL SETUP")
    print("=" * 70)

    print("\n[1/3] Building training dataset...")
    fetch_dataset()

    print("\n[2/3] Training Autoencoder...")
    metadata = train()

    print("\n[3/3] Sanity-checking inference pipeline...")
    reset_cache()  # force reload of fresh artifacts

    normal_sample = {
        "user": "dr_smith",
        "action": "USER_LOGIN",
        "details": "Access granted for role: doctor",
        "timestamp": datetime.utcnow().replace(hour=10),
    }
    suspicious_sample = {
        "user": "dr_smith",
        "action": "SECURITY_VIOLATION",
        "details": "Attempted to view Patient #42 folder outside consultation",
        "timestamp": datetime.utcnow().replace(hour=3),
    }
    print(f"  normal probe     -> {check_live_log(normal_sample)}")
    print(f"  suspicious probe -> {check_live_log(suspicious_sample)}")

    print("\n" + "=" * 70)
    print("  SETUP COMPLETE")
    print("=" * 70)
    print(f"  Threshold     : {metadata['threshold']:.6f} (P{metadata['percentile']})")
    print(f"  Input dim     : {metadata['input_dim']}")
    print(f"  Anomaly eval  : {metadata['anomaly_eval']}")
    print("\nRestart the backend to pick up the new artifacts.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nInterrupted.")
        sys.exit(130)
    except Exception as e:
        print(f"FATAL: {e}", file=sys.stderr)
        sys.exit(1)
