"""
config.py -- detection-layer configuration (Phase 1 credibility fix).

The single place to tune how a raw autoencoder reconstruction error becomes a
3-tier status (NORMAL / SUSPICIOUS / CRITICAL). No magic numbers elsewhere.

The autoencoder + this config are the ALGORITHMIC layer -- they decide.
The LLM layer (added later) only explains; it never changes these values.
"""
import os

# --- Status vocabulary (ordered low -> high) ---
STATUS_NORMAL = "NORMAL"
STATUS_SUSPICIOUS = "SUSPICIOUS"
STATUS_CRITICAL = "CRITICAL"
STATUS_ORDER = [STATUS_NORMAL, STATUS_SUSPICIOUS, STATUS_CRITICAL]

# --- Tier cutoffs on the NORMALIZED score (0.0 - 1.0) ---
# The normalized score is the event's percentile rank within normal training
# traffic: 0.90 == "more anomalous than 90% of normal events".
# Defaults: p90 -> SUSPICIOUS, p98 -> CRITICAL. Env-overridable for live tuning.
#   NOTE: at p90, ~10% of *normal* traffic reads SUSPICIOUS by design. Raise
#   SECURITY_SUSPICIOUS_THRESHOLD toward 0.95-0.97 if that is too noisy.
SUSPICIOUS_THRESHOLD = float(os.getenv("SECURITY_SUSPICIOUS_THRESHOLD", "0.90"))
CRITICAL_THRESHOLD = float(os.getenv("SECURITY_CRITICAL_THRESHOLD", "0.98"))

# --- Rule-based hard overrides ---
# Map an action type to the MINIMUM status it must receive, regardless of the
# autoencoder score. Rules can only RAISE a status, never lower it.
# Each entry: "ACTION" -> (minimum_status, rule_name)
RULE_OVERRIDES = {
    "SECURITY_VIOLATION": (STATUS_SUSPICIOUS, "SECURITY_VIOLATION_MIN_SUSPICIOUS"),
}

# Cold-start fallback: when the autoencoder cannot score an event yet (model
# not trained / not calibrated), do not cry wolf -- treat as NORMAL and let
# rule overrides still apply on top.
COLD_START_STATUS = STATUS_NORMAL

# When the detector genuinely errored (not merely "not trained"), be conservative.
DETECTOR_ERROR_STATUS = STATUS_SUSPICIOUS
