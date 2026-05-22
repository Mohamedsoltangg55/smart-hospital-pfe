"""
mock.py -- offline canned analysis (MOCK_LLM mode).

Produces a realistic, section-4-valid report with NO network call, derived
from the event context so it still reflects the actual flagged log. This is
the demo-day / offline path: it works with no API key and no internet.
"""
from __future__ import annotations

from typing import List, Tuple


def _likelihoods(action: str, features: List[str]) -> Tuple[str, str]:
    """Heuristic insider-threat / compromised-account likelihoods."""
    a = (action or "").upper()
    feat = set(features or [])
    insider, compromised = "LOW", "LOW"
    if a == "SECURITY_VIOLATION" or "ACCESS_OUTSIDE_CONSULTATION" in feat:
        insider = "MEDIUM"
    if a == "FOLDER_ACCESSED" or "ROLE_RESOURCE_MISMATCH" in feat:
        insider = "MEDIUM"
    if "OFF_HOURS_LOGIN" in feat or a == "USER_LOGIN":
        compromised = "MEDIUM"
    if "REPEATED_ACTIONS_BURST" in feat:
        insider = "HIGH"
    return insider, compromised


def build_mock_analysis(ctx: dict) -> dict:
    """Return a section-4 analysis dict tailored to the event context."""
    action = ctx.get("action_type", "UNKNOWN")
    role = ctx.get("role", "unknown")
    username = ctx.get("username", "?")
    status = ctx.get("status", "SUSPICIOUS")
    severity = ctx.get("severity", "MEDIUM")
    score = ctx.get("score")
    features = ctx.get("features_used") or []
    target = ctx.get("target_ref") or "the targeted resource"
    insider, compromised = _likelihoods(action, features)
    fired = ", ".join(features) if features else "anomalous reconstruction error"

    valid_levels = ("INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL")
    return {
        "incident_summary": (
            f"Operator '{username}' ({role}) performed {action}; the detection "
            f"algorithm flagged it as {status}."
        ),
        "why_suspicious": (
            f"The algorithmic detector raised this event based on: {fired}. "
            f"Anomaly score {score} maps to status {status} (read-only)."
        ),
        "security_risks": [
            "Potential unauthorized access to protected health information.",
            "Possible breach of patient confidentiality (GDPR / hospital policy).",
        ],
        "insider_threat": {
            "likelihood": insider,
            "reasoning": (
                "The action uses a legitimate account; the concern is whether the "
                "access had a valid care relationship and clinical justification."
            ),
        },
        "compromised_account": {
            "likelihood": compromised,
            "reasoning": (
                "No confirmed credential-theft indicators; review the login origin "
                "and timing to rule out account takeover."
            ),
        },
        "recommended_mitigations": [
            f"Confirm whether the {role} role is authorized for {action} on {target}.",
            "Check for repeated similar actions by the same operator.",
            "Verify a documented care relationship for any patient-data access.",
        ],
        "recommended_admin_response": [
            "Notify the security administrator / DPO of the flagged event.",
            "Contact the operator to confirm the business justification.",
            "If unjustified, suspend the session and open an incident ticket.",
        ],
        "severity": {
            "level": severity if severity in valid_levels else "MEDIUM",
            "explanation": (
                "Severity reflects the sensitivity of hospital patient data and the "
                f"algorithmic status ({status})."
            ),
        },
        "confidence": "MEDIUM",
        "mitre_attack_refs": ["T1078 Valid Accounts"],
        "disclaimer": (
            "AI-generated decision support; not a substitute for human review. "
            "(Offline mock analysis - MOCK_LLM mode.)"
        ),
    }
