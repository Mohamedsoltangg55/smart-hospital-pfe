"""
data_fetcher.py
---------------
Produces a baseline training dataset of healthcare audit logs.

Strategy:
    1. Attempt to download a public reference dataset (env-overridable URL).
    2. If unreachable or invalid, generate a high-fidelity synthetic dataset
       whose schema matches our `audit_logs` table exactly:
           user, action, details, timestamp

The synthetic generator models realistic hospital workflows:
    - Role-based shift patterns (doctors/nurses/reception/cashier/lab/admin)
    - Action mix per role
    - Weekday vs. weekend volumes
    - Injected anomaly archetypes used ONLY for threshold calibration
      (off-hours bursts, rapid folder access, SECURITY_VIOLATION events,
       role/action mismatches).

Usage:
    python -m ai_security_module.data_fetcher
"""
from __future__ import annotations

import csv
import io
import os
import random
import sys
from datetime import datetime, timedelta
from typing import List, Tuple

import pandas as pd

from .config import (
    DEFAULT_SEED,
    N_SYNTHETIC_ANOMALY,
    N_SYNTHETIC_NORMAL,
    RAW_DATA_PATH,
    ensure_dirs,
)

# Optional override: set HEALTHCARE_LOG_DATASET_URL to point to a CSV with
# columns (user, action, details, timestamp). If empty or fails, fall back
# to synthetic generation.
PUBLIC_DATASET_URL = os.getenv("HEALTHCARE_LOG_DATASET_URL", "").strip()


# --- Realistic action vocabulary (mirrors our backend log_action calls) ---
ROLE_ACTIONS = {
    "doctor": [
        "USER_LOGIN", "STATUS_CHANGED", "FOLDER_ACCESSED",
        "APPOINTMENT_STATUS_CHANGED", "CONSULTATION_SAVED",
        "LAB_ORDER_CREATED", "LAB_RESULTS_VALIDATED",
        "PATIENT_ADMITTED", "PATIENT_DISCHARGED",
    ],
    "nurse": [
        "USER_LOGIN", "NURSE_STATUS", "TASK_COMPLETED",
    ],
    "reception": [
        "USER_LOGIN", "PATIENT_REGISTERED",
        "TRIAGE_WALK-IN", "TRIAGE_SCHEDULED", "TRIAGE_EMERGENCY",
    ],
    "cashier": [
        "USER_LOGIN", "PAYMENT_RECEIVED", "LAB_PAYMENT_RECEIVED",
    ],
    "lab": [
        "USER_LOGIN", "LAB_RESULTS_SUBMITTED",
    ],
    "admin": [
        "USER_LOGIN", "USER_CREATED", "USER_UPDATED", "USER_DELETED",
        "FOLDER_ACCESSED",
    ],
}

# Typical shift windows per role (hour ranges, inclusive start, exclusive end)
ROLE_SHIFTS = {
    "doctor":    [(8, 18)],
    "nurse":     [(7, 15), (15, 23), (23, 31)],  # 23-31 wraps to next-day 07
    "reception": [(7, 19)],
    "cashier":   [(8, 17)],
    "lab":       [(8, 18)],
    "admin":     [(9, 17)],
}

ROLE_USERNAMES = {
    "doctor":    [f"dr_{n}" for n in ["smith","jones","patel","khan","garcia","leblanc","mansouri","ben_ali","torres","nguyen"]],
    "nurse":     [f"nurse_{n}" for n in ["alpha","beta","gamma","delta","epsilon","zeta","eta","theta"]],
    "reception": [f"reception_{n}" for n in ["a","b","c","d"]],
    "cashier":   [f"cashier_{n}" for n in ["a","b"]],
    "lab":       [f"lab_{n}" for n in ["a","b","c"]],
    "admin":     ["admin", "admin_backup"],
}


def _wrap_hour(h: int) -> int:
    return h % 24


def _shift_hour(role: str, rng: random.Random) -> int:
    shifts = ROLE_SHIFTS[role]
    start, end = rng.choice(shifts)
    raw = rng.randint(start, end - 1)
    return _wrap_hour(raw)


def _details_for(action: str, rng: random.Random) -> str:
    # Plausible, schema-matching free-text "details" used by our backend.
    pid = rng.randint(1, 4000)
    ticket = f"{rng.choice(['URG','STD','RDV'])}-{rng.randint(1,999):03d}"
    if action == "USER_LOGIN":
        return f"Access granted for role: {rng.choice(['doctor','nurse','reception','cashier','lab','admin'])}"
    if action == "STATUS_CHANGED":
        return f"Doctor went {rng.choice(['ONLINE','OFFLINE'])} in Room {rng.randint(1,30)}"
    if action == "NURSE_STATUS":
        return f"Infirmier went {rng.choice(['ONLINE','OFFLINE'])} in Room {rng.randint(1,30)}"
    if action == "PATIENT_REGISTERED":
        return f"Added Patient #{pid} - NSS: {rng.randint(100000000,999999999)}"
    if action.startswith("TRIAGE_"):
        return f"Patient #{pid} assigned Ticket {ticket}"
    if action == "FOLDER_ACCESSED":
        return f"Doctor opened folder for active Patient #{pid}"
    if action == "APPOINTMENT_STATUS_CHANGED":
        return f"Ticket {ticket}: Waiting -> In Progress"
    if action == "PAYMENT_RECEIVED":
        return f"Ticket {ticket} marked as Paid"
    if action == "LAB_PAYMENT_RECEIVED":
        return f"Lab order #{rng.randint(1,500)} paid"
    if action == "CONSULTATION_SAVED":
        return f"Medical record signed. Hash: {''.join(rng.choices('abcdef0123456789', k=10))}..."
    if action == "LAB_ORDER_CREATED":
        return f"Ordered 'NFS' for Patient #{pid} - Urgency: Normal"
    if action == "LAB_RESULTS_SUBMITTED":
        return f"Results entered for order #{rng.randint(1,500)}"
    if action == "LAB_RESULTS_VALIDATED":
        return f"Validated lab order #{rng.randint(1,500)}"
    if action == "PATIENT_ADMITTED":
        return f"Admitted Patient to Ward-A bed {rng.randint(1,30)}"
    if action == "PATIENT_DISCHARGED":
        return f"Discharged Patient from Ward-A"
    if action == "USER_CREATED":
        return f"Created user: staff_{rng.randint(1,99)}"
    if action == "USER_UPDATED":
        return f"Updated user: staff_{rng.randint(1,99)}"
    if action == "USER_DELETED":
        return f"Deleted user: staff_{rng.randint(1,99)}"
    if action == "TASK_COMPLETED":
        return f"Completed medical task for Patient #{pid}"
    return f"Event for Patient #{pid}"


def _generate_normal(n: int, rng: random.Random) -> List[dict]:
    rows: List[dict] = []
    now = datetime.utcnow().replace(microsecond=0)
    # Spread normal logs across the past 45 days
    span_days = 45
    while len(rows) < n:
        role = rng.choices(
            list(ROLE_ACTIONS.keys()),
            weights=[0.30, 0.25, 0.20, 0.10, 0.10, 0.05],
        )[0]
        user = rng.choice(ROLE_USERNAMES[role])
        action = rng.choice(ROLE_ACTIONS[role])

        day_offset = rng.randint(0, span_days - 1)
        base_day = now - timedelta(days=day_offset)
        # Reduce activity on weekends for non-clinical roles
        if base_day.weekday() >= 5 and role in {"admin", "reception", "cashier"}:
            if rng.random() < 0.7:
                continue

        hour = _shift_hour(role, rng)
        minute = rng.randint(0, 59)
        second = rng.randint(0, 59)
        ts = base_day.replace(hour=hour, minute=minute, second=second)

        rows.append({
            "user": user,
            "action": action,
            "details": _details_for(action, rng),
            "timestamp": ts.isoformat(),
            "label": "normal",
        })
    return rows


def _generate_anomalies(n: int, rng: random.Random) -> List[dict]:
    """Anomaly archetypes used for threshold calibration only."""
    rows: List[dict] = []
    now = datetime.utcnow().replace(microsecond=0)

    archetypes = ["off_hours_login", "rapid_folder_access",
                  "security_violation", "role_mismatch",
                  "mass_user_deletion"]

    while len(rows) < n:
        kind = rng.choice(archetypes)
        day_offset = rng.randint(0, 30)
        base = now - timedelta(days=day_offset)

        if kind == "off_hours_login":
            user = rng.choice(ROLE_USERNAMES[rng.choice(list(ROLE_USERNAMES))])
            hour = rng.choice([0, 1, 2, 3, 4])  # 00:00 - 04:59
            ts = base.replace(hour=hour, minute=rng.randint(0,59), second=rng.randint(0,59))
            rows.append({
                "user": user, "action": "USER_LOGIN",
                "details": "Access granted for role: doctor",
                "timestamp": ts.isoformat(), "label": "anomaly",
            })

        elif kind == "rapid_folder_access":
            user = rng.choice(ROLE_USERNAMES["doctor"])
            burst_start = base.replace(hour=rng.randint(8,17), minute=rng.randint(0,59), second=0)
            for k in range(rng.randint(20, 60)):
                ts = burst_start + timedelta(seconds=k * rng.randint(1, 3))
                rows.append({
                    "user": user, "action": "FOLDER_ACCESSED",
                    "details": f"Doctor opened folder for active Patient #{rng.randint(1,4000)}",
                    "timestamp": ts.isoformat(), "label": "anomaly",
                })
                if len(rows) >= n:
                    break

        elif kind == "security_violation":
            user = rng.choice(ROLE_USERNAMES[rng.choice(["doctor","nurse","reception"])])
            ts = base.replace(hour=rng.randint(0,23), minute=rng.randint(0,59), second=rng.randint(0,59))
            rows.append({
                "user": user, "action": "SECURITY_VIOLATION",
                "details": f"Attempted to view Patient #{rng.randint(1,4000)} folder outside consultation",
                "timestamp": ts.isoformat(), "label": "anomaly",
            })

        elif kind == "role_mismatch":
            # cashier performing folder access, etc.
            user = rng.choice(ROLE_USERNAMES["cashier"])
            ts = base.replace(hour=rng.randint(8,17), minute=rng.randint(0,59), second=rng.randint(0,59))
            rows.append({
                "user": user, "action": "FOLDER_ACCESSED",
                "details": f"Doctor opened folder for active Patient #{rng.randint(1,4000)}",
                "timestamp": ts.isoformat(), "label": "anomaly",
            })

        elif kind == "mass_user_deletion":
            user = "admin"
            burst_start = base.replace(hour=rng.choice([2, 3, 23]), minute=rng.randint(0,59), second=0)
            for k in range(rng.randint(8, 20)):
                ts = burst_start + timedelta(seconds=k * 4)
                rows.append({
                    "user": user, "action": "USER_DELETED",
                    "details": f"Deleted user: staff_{rng.randint(1,99)}",
                    "timestamp": ts.isoformat(), "label": "anomaly",
                })
                if len(rows) >= n:
                    break

    return rows[:n]


def _try_download(url: str) -> pd.DataFrame | None:
    try:
        import urllib.request
        print(f"[data_fetcher] Attempting download: {url}")
        with urllib.request.urlopen(url, timeout=10) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        df = pd.read_csv(io.StringIO(raw))
        required = {"user", "action", "details", "timestamp"}
        if not required.issubset(set(df.columns)):
            print(f"[data_fetcher] Remote CSV missing columns {required - set(df.columns)}; falling back to synthetic.")
            return None
        if "label" not in df.columns:
            df["label"] = "normal"
        print(f"[data_fetcher] Downloaded {len(df)} rows.")
        return df
    except Exception as e:
        print(f"[data_fetcher] Download failed ({e}); falling back to synthetic.")
        return None


def fetch_dataset(
    n_normal: int = N_SYNTHETIC_NORMAL,
    n_anomaly: int = N_SYNTHETIC_ANOMALY,
    seed: int = DEFAULT_SEED,
    output_path: str = RAW_DATA_PATH,
) -> str:
    """Produce a CSV at `output_path` and return its path."""
    ensure_dirs()
    rng = random.Random(seed)

    df = None
    if PUBLIC_DATASET_URL:
        df = _try_download(PUBLIC_DATASET_URL)

    if df is None:
        print(f"[data_fetcher] Generating synthetic dataset: {n_normal} normal + {n_anomaly} anomaly rows")
        normal = _generate_normal(n_normal, rng)
        anomaly = _generate_anomalies(n_anomaly, rng)
        df = pd.DataFrame(normal + anomaly)
        df = df.sort_values("timestamp").reset_index(drop=True)

    df.to_csv(output_path, index=False, quoting=csv.QUOTE_MINIMAL)
    print(f"[data_fetcher] Wrote dataset -> {output_path} ({len(df)} rows)")
    return output_path


if __name__ == "__main__":
    try:
        fetch_dataset()
    except Exception as e:
        print(f"[data_fetcher] FATAL: {e}", file=sys.stderr)
        sys.exit(1)
