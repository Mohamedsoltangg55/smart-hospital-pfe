"""
service.py -- AI analysis orchestration.

Flow:
    cache lookup -> build context -> (mock | LLM call + validate + 1 retry)
    -> typed fallback on failure -> persist to LogAnalysis -> audit -> return.

The LLM receives anomaly_score / status / severity as READ-ONLY facts; this
layer never recomputes them. The detection layer is not touched here.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from . import config
from .context_builder import build_analysis_context
from .llm_client import LLMUnavailable, complete_json
from .mock import build_mock_analysis
from .prompts import build_messages
from .schemas import CANON_DISCLAIMER, AnalysisReport

_FLAGGED_STATUSES = {"SUSPICIOUS", "CRITICAL"}


def is_flagged(log) -> bool:
    """Only logs the algorithmic layer flagged may be analyzed."""
    return (log.severity or "NORMAL").upper() in _FLAGGED_STATUSES


def _validate(raw_text: str):
    """Parse + validate raw LLM text against the section 4 schema.
    Returns the validated dict, or None on any failure."""
    try:
        data = json.loads(raw_text)
        return AnalysisReport(**data).model_dump()
    except Exception:
        return None


def _typed_fallback(ctx: dict, note: str) -> dict:
    """A section-4-valid report built purely from algorithmic facts, used when
    the LLM is unavailable or returns invalid JSON, so the UI always renders."""
    status = ctx.get("status", "SUSPICIOUS")
    features = ctx.get("features_used") or []
    flagged_by = ", ".join(features) if features else "anomalous autoencoder score"
    return {
        "incident_summary": (
            f"{ctx.get('action_type', 'Event')} by {ctx.get('username', '?')} "
            f"flagged {status} by the detection algorithm."
        ),
        "why_suspicious": (
            f"Flagged by: {flagged_by}. AI narrative analysis is unavailable "
            f"({note})."
        ),
        "security_risks": ["AI analysis could not be generated - manual review required."],
        "insider_threat": {
            "likelihood": "MEDIUM" if status == "CRITICAL" else "LOW",
            "reasoning": "AI analysis unavailable; assess manually from the raw event.",
        },
        "compromised_account": {
            "likelihood": "LOW",
            "reasoning": "AI analysis unavailable; assess manually from the raw event.",
        },
        "recommended_mitigations": [
            "Review the raw event and the fired detection rules manually.",
        ],
        "recommended_admin_response": [
            "Escalate to the security administrator for manual review.",
        ],
        "severity": {
            "level": ctx.get("severity", "MEDIUM"),
            "explanation": (
                f"Algorithmic status is {status}; AI severity assessment unavailable."
            ),
        },
        "confidence": "LOW",
        "mitre_attack_refs": [],
        "disclaimer": CANON_DISCLAIMER + " AI analysis temporarily unavailable - retry.",
    }


def generate_analysis(ctx: dict):
    """Produce a section-4 analysis for the context.
    Returns (analysis_dict, outcome) with outcome in {'mock', 'ok', 'fallback'}."""
    if config.MOCK_LLM:
        return build_mock_analysis(ctx), "mock"

    system_prompt, user_prompt = build_messages(ctx)
    attempts = 1 + max(0, config.LLM_JSON_RETRIES)
    note = "unknown error"
    for _ in range(attempts):
        try:
            raw = complete_json(system_prompt, user_prompt)
        except LLMUnavailable as e:
            note = str(e)
            break  # provider is down -> retrying within the timeout budget is pointless
        validated = _validate(raw)
        if validated is not None:
            return validated, "ok"
        note = "invalid JSON from model"
    return _typed_fallback(ctx, note), "fallback"


def _payload(log_id, model, generated_at, cached, analysis) -> dict:
    """The section 6.2 response payload."""
    return {
        "log_id": str(log_id),
        "model": model,
        "generated_at": generated_at,
        "cached": cached,
        "analysis": analysis,
    }


def get_cached_analysis(db, log):
    """Return the cached section 6.2 payload for a log, or None."""
    from app import models  # lazy import: avoid import cycles at module load
    row = (db.query(models.LogAnalysis)
             .filter(models.LogAnalysis.log_id == log.id)
             .first())
    if not row:
        return None
    try:
        analysis = json.loads(row.analysis_json)
    except (TypeError, ValueError):
        return None
    generated = row.generated_at.isoformat() if row.generated_at else None
    return _payload(log.id, row.model, generated, True, analysis)


def analyze_log(db, log, requested_by: str, force_refresh: bool = False) -> dict:
    """Main entry point. Returns the section 6.2 payload dict.

    Caches one analysis per log_id; force_refresh regenerates it. The analysis
    request itself is written to the audit log."""
    from app import models  # lazy import

    cached_row = (db.query(models.LogAnalysis)
                    .filter(models.LogAnalysis.log_id == log.id)
                    .first())

    # 1. cache hit
    if cached_row and not force_refresh:
        cached = get_cached_analysis(db, log)
        if cached:
            return cached

    # 2. build context + 3. generate (mock / LLM+validate+retry / fallback)
    ctx = build_analysis_context(db, log)
    analysis, outcome = generate_analysis(ctx)
    if outcome == "mock":
        model_name = "mock"
    elif outcome == "ok":
        model_name = config.LLM_MODEL
    else:
        model_name = f"{config.LLM_MODEL} (fallback)"
    now = datetime.now(timezone.utc)

    # 4. upsert the cache (one row per log_id)
    try:
        if cached_row:
            cached_row.model = model_name
            cached_row.generated_at = now
            cached_row.status = outcome
            cached_row.analysis_json = json.dumps(analysis)
            cached_row.requested_by = requested_by
        else:
            db.add(models.LogAnalysis(
                log_id=log.id, model=model_name, generated_at=now,
                status=outcome, analysis_json=json.dumps(analysis),
                requested_by=requested_by,
            ))
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"LogAnalysis cache write failed: {e}")

    # 5. audit the analysis request itself
    try:
        from app.main import log_action
        log_action(
            db, requested_by, "AI_ANALYSIS_REQUESTED",
            f"AI security analysis requested for audit log #{log.id} "
            f"(status={log.severity}, outcome={outcome})",
        )
    except Exception as e:
        print(f"Audit of analysis request failed: {e}")

    return _payload(log.id, model_name, now.isoformat(), False, analysis)
