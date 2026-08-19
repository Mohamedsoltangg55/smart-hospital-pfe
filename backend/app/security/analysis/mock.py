"""
mock.py -- offline canned analysis (MOCK_LLM mode).

Produces a realistic, section-4-valid report with NO network call, derived
from the event context so it still reflects the actual flagged log. This is
the demo-day / offline path: it works with no API key and no internet.
"""
from __future__ import annotations

from typing import List, Tuple


_BENIGN_CONTEXT_PHRASES = ("on-call", "on call", "emergency", "patient consent")


def _is_benign_context(ctx: dict) -> bool:
    """Detect an explicit benign-context marker in the event details.

    The real LLM does this reasoning natively; the offline mock relies on
    this heuristic so the demo's "benign false-positive" scenario reads
    differently from the genuine-attack ones.
    """
    text = (ctx.get("event_details") or "").lower()
    return any(p in text for p in _BENIGN_CONTEXT_PHRASES)


def _likelihoods(action: str, features: List[str]) -> Tuple[str, str]:
    """Heuristic insider-threat / compromised-account likelihoods."""
    a = (action or "").upper()
    feat = set(features or [])
    insider, compromised = "LOW", "LOW"
    if a == "SECURITY_VIOLATION" or "ACCESS_OUTSIDE_CONSULTATION" in feat:
        insider = "MEDIUM"
    if a == "FOLDER_ACCESSED" or "ROLE_RESOURCE_MISMATCH" in feat:
        insider = "MEDIUM"
    # An OFF_HOURS_LOGIN by name implicates the credentials directly; rank
    # it higher than a plain USER_LOGIN signal.
    if "OFF_HOURS_LOGIN" in feat:
        compromised = "HIGH"
    elif a == "USER_LOGIN":
        compromised = "MEDIUM"
    if "REPEATED_ACTIONS_BURST" in feat:
        insider = "HIGH"
    return insider, compromised


def _build_benign_report(ctx: dict, action: str, role: str, username: str,
                        status: str, severity: str, fired: str,
                        valid_levels: tuple) -> dict:
    """A softer mock report used when the event details indicate a legitimate
    context (on-call shift, emergency, documented consent)."""
    return {
        "incident_summary": (
            f"{action} by '{username}' ({role}) was flagged by the algorithm, "
            "but the event context indicates a legitimate care scenario."
        ),
        "why_suspicious": (
            f"The detector raised this event on: {fired}. However, the event "
            "details explicitly mention an on-call / emergency context, which "
            "the contextual layer treats as a strong benign indicator."
        ),
        "security_risks": [
            "Likely-benign context detected (on-call shift / emergency callout / consented access).",
            "Manual confirmation still recommended for hospital governance.",
        ],
        "insider_threat": {
            "likelihood": "LOW",
            "reasoning": (
                "The event details cite an on-call / emergency duty; the "
                "action has a plausible clinical justification consistent "
                "with that workflow."
            ),
        },
        "compromised_account": {
            "likelihood": "LOW",
            "reasoning": (
                "No off-hours/unusual-source credential indicators in this "
                "event beyond the documented on-call context."
            ),
        },
        "recommended_mitigations": [
            f"Confirm the on-call assignment for the {role} on this date.",
            "No immediate response required; archive once reviewed.",
        ],
        "recommended_admin_response": [
            "No escalation required -- annotate the event as benign in the audit log.",
            "If recurring spurious flags, retrain the autoencoder with on-call examples.",
        ],
        "severity": {
            # The algorithmic layer's status is preserved as a read-only fact
            # in the modal's "algorithmic facts" panel; here the analysis
            # severity is intentionally downgraded to LOW to reflect the
            # contextual conclusion. This is what "the LLM contextualizes
            # rather than rubber-stamps the algorithm" looks like.
            "level": "LOW",
            "explanation": (
                f"The algorithmic layer flagged this event at {status}; the "
                "contextual review downgrades the analysis severity to LOW "
                "because the event details are consistent with documented "
                "on-call / emergency duty."
            ),
        },
        "confidence": "HIGH",
        "mitre_attack_refs": [],
        "disclaimer": (
            "AI-generated decision support; not a substitute for human review. "
            "(Offline mock analysis - MOCK_LLM mode. Contextual likely-benign read.)"
        ),
    }


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

    if _is_benign_context(ctx):
        return _build_benign_report(
            ctx, action, role, username, status, severity, fired, valid_levels,
        )

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
