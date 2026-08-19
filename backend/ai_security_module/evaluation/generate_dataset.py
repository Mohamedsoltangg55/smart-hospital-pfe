"""
generate_dataset.py
-------------------
Extended synthetic-data generator for the offline model-comparison study.

Builds on ai_security_module.data_fetcher's role / action / shift taxonomy
and produces a LARGER, more varied labeled dataset than the one currently
used to train the live autoencoder:

  * ~12 000 NORMAL rows  -- six roles, shift-aligned hours, action mixes
                            that respect the role, weekday/weekend volume
                            differences, and a 60-day timespan.
  * ~3 000  ANOMALY rows -- seven attack archetypes drawn from the same
                            schema so the classifier cannot trivially
                            tell them apart from normal traffic.

Each row carries a binary `label` (0 = normal, 1 = anomaly). The dataset
is saved as a CSV so the cross-validation study is reproducible.

This file does NOT touch the live detection pipeline -- the live system
keeps using artifacts/data/healthcare_audit_logs.csv unchanged.
"""
from __future__ import annotations

import csv
import os
import random
from datetime import datetime, timedelta
from typing import List

import pandas as pd

# Reuse the live module's role / action taxonomy so the synthetic
# distribution stays aligned with what the live pipeline sees.
from ai_security_module.data_fetcher import (
    ROLE_ACTIONS, ROLE_SHIFTS, ROLE_USERNAMES, _details_for, _wrap_hour,
)


# ----------------------------------------------------------------------
# Output configuration
# ----------------------------------------------------------------------
EVAL_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(EVAL_DIR, "data")
DATASET_PATH = os.path.join(DATA_DIR, "dataset.csv")

DEFAULT_SEED = 42

# Dataset sizing -- intentionally several times larger than the live
# trainer's defaults (12000 / 600) so the cross-validation study has
# enough rows per fold to be stable.
N_NORMAL = 12000
# Per-archetype anomaly counts. Sum ~= 3000, giving an ~80/20 class
# balance that is realistic for security audit data.
N_ANOMALY_BY_KIND = {
    "off_hours_login":          600,   # USER_LOGIN at 00-05 UTC
    "outside_consultation":     500,   # SECURITY_VIOLATION, "outside consultation"
    "folder_exfiltration":      550,   # FOLDER_ACCESSED burst on many patients
    "role_mismatch":            400,   # cashier/reception/lab doing clinical actions
    "weekend_admin":            300,   # admin user mgmt on weekend nights
    "mass_user_deletion":       350,   # USER_DELETED burst by admin
    "lab_tech_browsing":        300,   # lab role opening many folders
}


# ----------------------------------------------------------------------
# Normal traffic
# ----------------------------------------------------------------------
def _generate_normal(n: int, rng: random.Random) -> List[dict]:
    """Realistic baseline traffic across roles, shifts and a 60-day span."""
    rows: List[dict] = []
    now = datetime.utcnow().replace(microsecond=0)
    span_days = 60

    role_choices = list(ROLE_ACTIONS.keys())
    role_weights = [0.30, 0.25, 0.20, 0.10, 0.10, 0.05]  # doctor-heavy

    while len(rows) < n:
        role = rng.choices(role_choices, weights=role_weights)[0]
        user = rng.choice(ROLE_USERNAMES[role])
        action = rng.choice(ROLE_ACTIONS[role])

        day_offset = rng.randint(0, span_days - 1)
        base_day = now - timedelta(days=day_offset)

        # Non-clinical roles see ~70% less activity on weekends.
        if base_day.weekday() >= 5 and role in {"admin", "reception", "cashier"}:
            if rng.random() < 0.70:
                continue

        # Shift-aligned hour, with a small chance of mild over/under runs
        # so the legitimate distribution is not perfectly clean.
        shift_start, shift_end = rng.choice(ROLE_SHIFTS[role])
        hour = _wrap_hour(rng.randint(shift_start, shift_end - 1))
        if rng.random() < 0.04:
            # Tiny "stayed late" tail -- still NORMAL.
            hour = _wrap_hour(hour + rng.choice([-1, 1]))

        ts = base_day.replace(
            hour=hour,
            minute=rng.randint(0, 59),
            second=rng.randint(0, 59),
        )

        rows.append({
            "user": user,
            "action": action,
            "details": _details_for(action, rng),
            "timestamp": ts.isoformat(),
            "label": 0,
        })
    return rows


# ----------------------------------------------------------------------
# Attack archetypes
# ----------------------------------------------------------------------
def _gen_off_hours_login(n: int, rng: random.Random) -> List[dict]:
    """USER_LOGIN events at 00-05 UTC. Cross-role to broaden coverage."""
    rows: List[dict] = []
    while len(rows) < n:
        role = rng.choice(list(ROLE_USERNAMES.keys()))
        user = rng.choice(ROLE_USERNAMES[role])
        base = datetime.utcnow().replace(microsecond=0) - timedelta(days=rng.randint(0, 60))
        hour = rng.choice([0, 1, 2, 3, 4])
        ts = base.replace(hour=hour, minute=rng.randint(0, 59), second=rng.randint(0, 59))
        rows.append({
            "user": user, "action": "USER_LOGIN",
            "details": f"Access granted for role: {role}",
            "timestamp": ts.isoformat(), "label": 1,
        })
    return rows


def _gen_outside_consultation(n: int, rng: random.Random) -> List[dict]:
    """SECURITY_VIOLATION events whose details mention 'outside consultation'."""
    rows: List[dict] = []
    while len(rows) < n:
        role = rng.choice(["doctor", "nurse", "reception"])
        user = rng.choice(ROLE_USERNAMES[role])
        base = datetime.utcnow().replace(microsecond=0) - timedelta(days=rng.randint(0, 60))
        ts = base.replace(
            hour=rng.randint(0, 23),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 59),
        )
        rows.append({
            "user": user, "action": "SECURITY_VIOLATION",
            "details": (f"Attempted to view Patient #{rng.randint(1, 4000)} "
                        "folder outside consultation"),
            "timestamp": ts.isoformat(), "label": 1,
        })
    return rows


def _gen_folder_exfiltration(n: int, rng: random.Random) -> List[dict]:
    """Burst of FOLDER_ACCESSED on many patients in ~2 minutes by a doctor."""
    rows: List[dict] = []
    while len(rows) < n:
        user = rng.choice(ROLE_USERNAMES["doctor"])
        base = datetime.utcnow().replace(microsecond=0) - timedelta(days=rng.randint(0, 60))
        # Inside business hours -- the burst itself is the signal, not the time.
        burst_start = base.replace(
            hour=rng.randint(8, 17),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 30),
        )
        burst_size = rng.randint(20, 40)
        spacing = rng.randint(2, 5)  # seconds between accesses -> ~1-3 min total
        for k in range(burst_size):
            if len(rows) >= n:
                break
            ts = burst_start + timedelta(seconds=k * spacing)
            rows.append({
                "user": user, "action": "FOLDER_ACCESSED",
                "details": f"Doctor opened folder for active Patient #{rng.randint(1, 4000)}",
                "timestamp": ts.isoformat(), "label": 1,
            })
    return rows[:n]


def _gen_role_mismatch(n: int, rng: random.Random) -> List[dict]:
    """A role performing an action that is outside its mandate."""
    rows: List[dict] = []
    while len(rows) < n:
        kind = rng.choice([
            ("cashier",   "FOLDER_ACCESSED",
             "Cashier opened folder for active Patient #{pid}"),
            ("reception", "LAB_ORDER_CREATED",
             "Ordered 'NFS' for Patient #{pid} - Urgency: Normal"),
            ("lab",       "CONSULTATION_SAVED",
             "Medical record signed. Hash: {hash}..."),
        ])
        role, action, tmpl = kind
        user = rng.choice(ROLE_USERNAMES[role])
        base = datetime.utcnow().replace(microsecond=0) - timedelta(days=rng.randint(0, 60))
        ts = base.replace(
            hour=rng.randint(8, 17),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 59),
        )
        details = tmpl.format(
            pid=rng.randint(1, 4000),
            hash="".join(rng.choices("abcdef0123456789", k=10)),
        )
        rows.append({
            "user": user, "action": action, "details": details,
            "timestamp": ts.isoformat(), "label": 1,
        })
    return rows


def _gen_weekend_admin(n: int, rng: random.Random) -> List[dict]:
    """Admin doing user-management on a weekend night. Subtle anomaly."""
    rows: List[dict] = []
    while len(rows) < n:
        user = rng.choice(ROLE_USERNAMES["admin"])
        # Find a recent weekend day.
        now = datetime.utcnow().replace(microsecond=0)
        for _ in range(20):
            d = now - timedelta(days=rng.randint(0, 60))
            if d.weekday() >= 5:  # Sat/Sun
                break
        action = rng.choice(["USER_CREATED", "USER_UPDATED", "USER_DELETED"])
        ts = d.replace(
            hour=rng.choice([0, 1, 2, 22, 23]),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 59),
        )
        rows.append({
            "user": user, "action": action,
            "details": f"{action.split('_')[0].title()} user: staff_{rng.randint(1, 99)}",
            "timestamp": ts.isoformat(), "label": 1,
        })
    return rows


def _gen_mass_user_deletion(n: int, rng: random.Random) -> List[dict]:
    """USER_DELETED burst by admin, typically at odd hours."""
    rows: List[dict] = []
    while len(rows) < n:
        user = "admin"
        base = datetime.utcnow().replace(microsecond=0) - timedelta(days=rng.randint(0, 60))
        burst_start = base.replace(
            hour=rng.choice([2, 3, 22, 23]),
            minute=rng.randint(0, 59),
            second=0,
        )
        burst_size = rng.randint(10, 25)
        for k in range(burst_size):
            if len(rows) >= n:
                break
            ts = burst_start + timedelta(seconds=k * 4)
            rows.append({
                "user": user, "action": "USER_DELETED",
                "details": f"Deleted user: staff_{rng.randint(1, 99)}",
                "timestamp": ts.isoformat(), "label": 1,
            })
    return rows[:n]


def _gen_lab_tech_browsing(n: int, rng: random.Random) -> List[dict]:
    """Lab technician opening many patient folders -- clear role mismatch."""
    rows: List[dict] = []
    while len(rows) < n:
        user = rng.choice(ROLE_USERNAMES["lab"])
        base = datetime.utcnow().replace(microsecond=0) - timedelta(days=rng.randint(0, 60))
        burst_start = base.replace(
            hour=rng.randint(8, 17),
            minute=rng.randint(0, 59),
            second=rng.randint(0, 30),
        )
        burst_size = rng.randint(5, 15)
        for k in range(burst_size):
            if len(rows) >= n:
                break
            ts = burst_start + timedelta(seconds=k * rng.randint(15, 60))
            rows.append({
                "user": user, "action": "FOLDER_ACCESSED",
                "details": f"Doctor opened folder for active Patient #{rng.randint(1, 4000)}",
                "timestamp": ts.isoformat(), "label": 1,
            })
    return rows[:n]


_ARCHETYPE_FUNCS = {
    "off_hours_login":      _gen_off_hours_login,
    "outside_consultation": _gen_outside_consultation,
    "folder_exfiltration":  _gen_folder_exfiltration,
    "role_mismatch":        _gen_role_mismatch,
    "weekend_admin":        _gen_weekend_admin,
    "mass_user_deletion":   _gen_mass_user_deletion,
    "lab_tech_browsing":    _gen_lab_tech_browsing,
}


def _generate_anomalies(rng: random.Random) -> List[dict]:
    rows: List[dict] = []
    for kind, count in N_ANOMALY_BY_KIND.items():
        rows.extend(_ARCHETYPE_FUNCS[kind](count, rng))
    return rows


# ----------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------
def build_dataset(
    seed: int = DEFAULT_SEED,
    output_path: str = DATASET_PATH,
) -> pd.DataFrame:
    """Generate, sort, save and return the labeled dataset."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    rng = random.Random(seed)

    normal = _generate_normal(N_NORMAL, rng)
    anomaly = _generate_anomalies(rng)
    df = pd.DataFrame(normal + anomaly)
    df = df.sort_values("timestamp").reset_index(drop=True)
    df.to_csv(output_path, index=False, quoting=csv.QUOTE_MINIMAL)
    return df


def print_summary(df: pd.DataFrame) -> None:
    n_total = len(df)
    n_normal = int((df["label"] == 0).sum())
    n_anomaly = int((df["label"] == 1).sum())
    print(f"[dataset] total rows:    {n_total}")
    print(f"[dataset]   normal (0):  {n_normal} ({100 * n_normal / n_total:.2f}%)")
    print(f"[dataset]   anomaly (1): {n_anomaly} ({100 * n_anomaly / n_total:.2f}%)")
    print(f"[dataset] role distribution (top 5):")
    role_counts = df["user"].str.extract(r"^([a-z]+)_?", expand=False).value_counts().head(5)
    for k, v in role_counts.items():
        print(f"  {k:<10s} {v}")


if __name__ == "__main__":
    df = build_dataset()
    print_summary(df)
    print(f"[dataset] wrote -> {DATASET_PATH}")
