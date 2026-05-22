"""
prompts.py -- system + user prompts for the SOC analysis LLM (brief section 10).

The section 4 schema is embedded in the user prompt so the model returns
exactly the structure schema_validator expects.
"""
from __future__ import annotations

SYSTEM_PROMPT = """You are a SOC (Security Operations Center) cybersecurity analyst assistant for a
hospital information system. You provide contextual analysis of a security event
that has ALREADY been flagged as anomalous by a separate detection algorithm.

Hard rules:
- You DO NOT detect anomalies and you DO NOT compute, change, or second-guess the
  numeric anomaly_score or status. Treat them as given facts.
- You only explain, contextualize, assess threat type, and recommend response.
- Healthcare context: patient data is highly sensitive; unauthorized access is a
  privacy violation (GDPR / hospital confidentiality). Weigh severity accordingly.
- Be precise, professional, and concise. No speculation presented as fact.
- Output ONLY valid JSON matching the provided schema. No text outside the JSON."""

# The section 4 schema, embedded verbatim in the user prompt.
SCHEMA_SPEC = """{
  "incident_summary": "string - 1-2 sentence headline of what happened",
  "why_suspicious": "string - plain explanation of why the algorithm flagged this",
  "security_risks": ["string", "..."],
  "insider_threat": { "likelihood": "LOW | MEDIUM | HIGH", "reasoning": "string" },
  "compromised_account": { "likelihood": "LOW | MEDIUM | HIGH", "reasoning": "string" },
  "recommended_mitigations": ["string", "..."],
  "recommended_admin_response": ["string", "..."],
  "severity": { "level": "INFO | LOW | MEDIUM | HIGH | CRITICAL", "explanation": "string" },
  "confidence": "LOW | MEDIUM | HIGH",
  "mitre_attack_refs": ["optional, e.g. T1078 Valid Accounts"],
  "disclaimer": "AI-generated decision support; not a substitute for human review."
}"""

_USER_TEMPLATE = """A hospital audit event was flagged by our detection algorithm. Analyze it.

EVENT (read-only facts from the algorithm):
- timestamp: {timestamp}
- operator_role: {role}        (username: {username})
- action_type: {action_type}
- event_details: {event_details}
- target: {target_type} {target_ref}
- anomaly_score: {score}       (DO NOT change this)
- status: {status}             severity_hint: {severity}
- detector: {detector}
- context_features: {features_used}
- operator_recent_actions_5min: {recent_count}

Return ONLY JSON in this exact schema:
{schema}"""


def build_messages(ctx: dict):
    """Return (system_prompt, user_prompt) for the given analysis context."""
    user = _USER_TEMPLATE.format(
        timestamp=ctx.get("timestamp", "?"),
        role=ctx.get("role", "?"),
        username=ctx.get("username", "?"),
        action_type=ctx.get("action_type", "?"),
        event_details=ctx.get("event_details", "?"),
        target_type=ctx.get("target_type") or "-",
        target_ref=ctx.get("target_ref") or "-",
        score=ctx.get("score", "?"),
        status=ctx.get("status", "?"),
        severity=ctx.get("severity", "?"),
        detector=ctx.get("detector", "?"),
        features_used=", ".join(ctx.get("features_used") or []) or "none",
        recent_count=ctx.get("recent_count", 0),
        schema=SCHEMA_SPEC,
    )
    return SYSTEM_PROMPT, user
