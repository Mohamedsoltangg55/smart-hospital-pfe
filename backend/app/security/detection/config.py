"""
config.py -- detection-layer configuration.

The single place to tune the HYBRID detector. No magic numbers elsewhere.

Hybrid detector (see README.md):
  * Rule engine  -- PRIMARY, high-precision, deterministic, no training.
  * Autoencoder  -- SECONDARY "unknown pattern" signal (anomaly score).
Both feed classifier.classify(); the higher status wins. Signals only RAISE.

The detection layer (autoencoder + rules + this config) DECIDES status/score.
The LLM layer only EXPLAINS -- it never changes these values.
"""
import os

# --- Status vocabulary (ordered low -> high) ---
STATUS_NORMAL = "NORMAL"
STATUS_SUSPICIOUS = "SUSPICIOUS"
STATUS_CRITICAL = "CRITICAL"
STATUS_ORDER = [STATUS_NORMAL, STATUS_SUSPICIOUS, STATUS_CRITICAL]

# Detector identity recorded on every classified event (section 6.1 schema).
DETECTOR_NAME = "hybrid-v1 (autoencoder + rule_engine)"

# ======================================================================
#  Autoencoder score -> tier   (the SECONDARY signal)
# ======================================================================
# Tier cutoffs on the NORMALIZED score (0.0-1.0). The normalized score is the
# event's percentile rank within benign traffic: 0.90 == more anomalous than
# 90% of benign events. Defaults: p90 -> SUSPICIOUS, p98 -> CRITICAL.
SUSPICIOUS_THRESHOLD = float(os.getenv("SECURITY_SUSPICIOUS_THRESHOLD", "0.90"))
CRITICAL_THRESHOLD = float(os.getenv("SECURITY_CRITICAL_THRESHOLD", "0.98"))

# --- Normalization anchor source ---
# "real"      -> prefer anchors recomputed from real benign logs (anchors.json)
# "synthetic" -> always use the autoencoder's synthetic threshold.json anchors
# The autoencoder was trained on synthetic data and over-scores real traffic,
# so "real" anchors are the interim default until the model is retrained.
ANCHOR_SOURCE = os.getenv("SECURITY_ANCHOR_SOURCE", "real")
REAL_ANCHORS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "anchors.json")
# Minimum benign samples required before a recalibration is accepted. Kept low
# on purpose: this is an interim stop-gap on scarce real data (see README).
MIN_CALIBRATION_SAMPLES = int(os.getenv("SECURITY_MIN_CALIBRATION_SAMPLES", "20"))

# --- Cold-start / detector-error fallbacks ---
COLD_START_STATUS = STATUS_NORMAL          # model not calibrated yet -> don't cry wolf
DETECTOR_ERROR_STATUS = STATUS_SUSPICIOUS  # detector genuinely errored -> be careful

# ======================================================================
#  Rule engine   (the PRIMARY signal) -- deterministic, no training
# ======================================================================
# Office hours: a USER_LOGIN outside [START, END) counts as off-hours.
# Pinned to a generous daytime window (06:00-22:00) so normal working-hours
# and demo logins are NOT flagged; genuine deep-night access still trips it.
OFFICE_HOURS_START = int(os.getenv("SECURITY_OFFICE_HOURS_START", "6"))
OFFICE_HOURS_END = int(os.getenv("SECURITY_OFFICE_HOURS_END", "22"))

# Lower-cased substrings in an event's details that indicate medical-record
# access outside a legitimate consultation context.
OUTSIDE_CONSULTATION_PHRASES = [
    "outside consultation",
    "hors consultation",
]

# Repeated-action burst: >= N events by the SAME operator within the window.
BURST_WINDOW_MINUTES = int(os.getenv("SECURITY_BURST_WINDOW_MINUTES", "5"))
BURST_COUNT_SUSPICIOUS = int(os.getenv("SECURITY_BURST_COUNT_SUSPICIOUS", "12"))
BURST_COUNT_CRITICAL = int(os.getenv("SECURITY_BURST_COUNT_CRITICAL", "25"))

# Role-resource mismatch: actions a given role should never perform. Clinical
# data access by non-clinical roles is the headline case. Roles come from
# roles.role_of(); keep this conservative to avoid false positives.
ROLE_FORBIDDEN_ACTIONS = {
    "cashier": {
        "FOLDER_ACCESSED", "CONSULTATION_SAVED", "LAB_ORDER_CREATED",
        "LAB_RESULTS_SUBMITTED", "LAB_RESULTS_VALIDATED",
        "PATIENT_ADMITTED", "PATIENT_DISCHARGED",
    },
    "reception": {
        "CONSULTATION_SAVED", "LAB_ORDER_CREATED",
        "LAB_RESULTS_SUBMITTED", "LAB_RESULTS_VALIDATED",
    },
    "lab": {
        "FOLDER_ACCESSED", "CONSULTATION_SAVED",
        "PATIENT_ADMITTED", "PATIENT_DISCHARGED",
    },
}
