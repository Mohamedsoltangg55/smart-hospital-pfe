"""
routes.py
---------
Security Audit Logs REST API (Phase 2).

Read-only endpoints over the audit_logs table, returning the section 6.1
schema inside a { data, error } envelope. Search / date / status filtering
and pagination are all SERVER-SIDE -- the frontend does no client-side
filtering.

Mounted via app.include_router() in main.py (decision D). The /analyze
endpoint + LLM live in the `analysis` package (Phase 3).
"""
from __future__ import annotations

import json
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from .analysis import config as analysis_config
from .analysis.service import analyze_log, get_cached_analysis, is_flagged
from .detection.roles import role_of
from .schemas import (
    AnomalyDTO, AuditLogDTO, ErrorDTO, LogsData, LogsEnvelope,
    OperatorDTO, PageMeta, SummaryData, SummaryEnvelope, TargetDTO,
)

# ======================================================================
#  Phase 5 hardening: EVERY route in this router requires an authenticated
#  user holding the "admin" or "security_officer" role. Audit/security data
#  is never served unauthenticated -- this is enforced on the backend, not
#  merely hidden in the UI.
# ======================================================================
SECURITY_ROLES = ("admin", "security_officer")


async def require_security_role(request: Request, db: Session = Depends(get_db)):
    """Auth guard applied to every /api/security/* route.

    Resolves the JWT via main.get_current_user (lazy-imported: main.py
    imports this module at line ~215, before require_role is defined, so a
    top-level import would be circular) and rejects any user whose role is
    not in SECURITY_ROLES with a 403.
    """
    from ..main import get_current_user  # lazy import -- avoids import cycle
    user = await get_current_user(request, db)
    if user.role not in SECURITY_ROLES:
        raise HTTPException(
            status_code=403,
            detail=f"Access denied. Required role: {', '.join(SECURITY_ROLES)}",
        )
    return user


router = APIRouter(
    prefix="/api/security",
    tags=["security"],
    dependencies=[Depends(require_security_role)],
)

_VALID_STATUS = {"NORMAL", "SUSPICIOUS", "CRITICAL"}
_MAX_PAGE_SIZE = 100


def _norm_status(value: Optional[str]) -> str:
    """Map any stored severity value (incl. legacy ones) to a 3-tier status."""
    s = (value or "NORMAL").upper()
    if s == "CRITICAL":
        return "CRITICAL"
    if s in ("SUSPICIOUS", "SUSPICIOUS_UNKNOWN_PATTERN"):
        return "SUSPICIOUS"
    return "NORMAL"


def _parse_date(value: str) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        try:
            return datetime.strptime(value, "%Y-%m-%d")
        except ValueError:
            return None


def _row_to_dto(row) -> AuditLogDTO:
    """Map an AuditLog row onto the section 6.1 DTO."""
    score = None
    if row.anomaly_score:
        try:
            score = float(row.anomaly_score)
        except (TypeError, ValueError):
            score = None

    features = []
    if row.features_used:
        try:
            features = json.loads(row.features_used)
        except (TypeError, ValueError):
            features = []

    target = None
    if row.target_type or row.target_ref:
        target = TargetDTO(type=row.target_type, ref=row.target_ref)

    return AuditLogDTO(
        id=str(row.id),
        timestamp=row.timestamp.isoformat() if row.timestamp else None,
        operator=OperatorDTO(
            id=None,
            username=row.user or "System",
            role=row.operator_role or role_of(row.user or ""),
        ),
        action_type=row.action,
        event_details=row.details,
        target=target,
        source_ip=row.source_ip,
        anomaly=AnomalyDTO(
            score=score,
            status=_norm_status(row.severity),
            severity=row.anomaly_severity,
            detector=row.detector,
            rule_overrides=[f for f in features if f != "AUTOENCODER_SCORE"],
            features_used=features,
        ),
    )


@router.get("/logs", response_model=LogsEnvelope)
def list_logs(
    search: str = "",
    from_: str = Query("", alias="from"),
    to: str = "",
    status: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(15, ge=1, le=_MAX_PAGE_SIZE),
    db: Session = Depends(get_db),
):
    """Paginated, server-side-filtered audit log list."""
    try:
        q = db.query(models.AuditLog)

        if search:
            like = f"%{search.strip()}%"
            q = q.filter(or_(
                models.AuditLog.user.ilike(like),
                models.AuditLog.action.ilike(like),
                models.AuditLog.details.ilike(like),
            ))
        if status and status.upper() in _VALID_STATUS:
            q = q.filter(func.upper(models.AuditLog.severity) == status.upper())
        d_from = _parse_date(from_)
        if d_from:
            q = q.filter(models.AuditLog.timestamp >= d_from)
        d_to = _parse_date(to)
        if d_to:
            q = q.filter(models.AuditLog.timestamp < d_to + timedelta(days=1))

        total = q.count()
        rows = (q.order_by(models.AuditLog.timestamp.desc())
                 .offset((page - 1) * page_size)
                 .limit(page_size)
                 .all())
        total_pages = (total + page_size - 1) // page_size if total else 0

        return LogsEnvelope(data=LogsData(
            items=[_row_to_dto(r) for r in rows],
            page=PageMeta(page=page, page_size=page_size,
                          total=total, total_pages=total_pages),
        ))
    except Exception as e:
        return LogsEnvelope(error=ErrorDTO(code="LOGS_QUERY_FAILED", message=str(e)))


@router.get("/logs/summary", response_model=SummaryEnvelope)
def logs_summary(db: Session = Depends(get_db)):
    """KPI counters for today's audit activity."""
    try:
        now = datetime.utcnow()
        today = datetime(now.year, now.month, now.day)
        base = db.query(models.AuditLog).filter(models.AuditLog.timestamp >= today)

        return SummaryEnvelope(data=SummaryData(
            total_events=base.count(),
            security_violations=base.filter(
                models.AuditLog.action.ilike("%SECURITY_VIOLATION%")).count(),
            ai_anomalies=base.filter(
                func.upper(models.AuditLog.severity).in_(["SUSPICIOUS", "CRITICAL"])).count(),
            user_connections=base.filter(
                models.AuditLog.action.ilike("%USER_LOGIN%")).count(),
        ))
    except Exception as e:
        return SummaryEnvelope(error=ErrorDTO(code="SUMMARY_QUERY_FAILED", message=str(e)))


# ----------------------------------------------------------------------
#  AI analysis endpoints (Phase 3) -- LLM contextual analysis.
#  The LLM only EXPLAINS; it never recomputes score/status (see analysis/).
# ----------------------------------------------------------------------

def _error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """A { data, error } envelope with a proper HTTP status code."""
    return JSONResponse(
        status_code=status_code,
        content={"data": None, "error": {"code": code, "message": message}},
    )


# In-memory per-user sliding-window rate limiter for the analyze endpoint.
# Keyed by username; protects the Groq free-tier quota. Limits are
# config-driven (analysis.config.ANALYZE_RATE_*). Process-local: fine for a
# single-worker deployment; a multi-worker setup would move this to Redis.
_rate_lock = threading.Lock()
_rate_hits: dict[str, deque] = defaultdict(deque)


def _check_analyze_rate_limit(username: str) -> tuple[bool, int]:
    """Return (allowed, retry_after_seconds) for a user's analyze request."""
    window = analysis_config.ANALYZE_RATE_WINDOW_SECONDS
    limit = analysis_config.ANALYZE_RATE_MAX
    now = time.monotonic()
    with _rate_lock:
        hits = _rate_hits[username]
        while hits and now - hits[0] >= window:
            hits.popleft()
        if len(hits) >= limit:
            return False, int(window - (now - hits[0])) + 1
        hits.append(now)
        return True, 0


@router.post("/logs/{log_id}/analyze")
async def analyze_log_endpoint(
    log_id: int,
    request: Request,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_security_role),
):
    """Request an LLM contextual analysis for one flagged audit log.

    Body (optional): { "force_refresh": bool }. The requester identity is
    taken from the authenticated JWT, never from the body. Logs the
    algorithmic layer did NOT flag are rejected with a clear message, and
    the endpoint is rate-limited per user to protect the LLM provider quota.
    """
    log = db.query(models.AuditLog).filter(models.AuditLog.id == log_id).first()
    if not log:
        return _error_response(404, "LOG_NOT_FOUND", f"Audit log #{log_id} not found.")
    if not is_flagged(log):
        return _error_response(
            400, "LOG_NOT_FLAGGED",
            "Only SUSPICIOUS or CRITICAL logs can be analyzed; this log is NORMAL.",
        )

    # Per-user rate limit -- protects the Groq free-tier quota.
    allowed, retry_after = _check_analyze_rate_limit(current_user.username)
    if not allowed:
        return _error_response(
            429, "RATE_LIMITED",
            f"Analysis rate limit reached "
            f"({analysis_config.ANALYZE_RATE_MAX} per "
            f"{analysis_config.ANALYZE_RATE_WINDOW_SECONDS}s). "
            f"Please try again in {retry_after}s.",
        )

    # Tolerant body parsing: a missing or non-JSON body is treated as {}.
    try:
        body = await request.json()
        if not isinstance(body, dict):
            body = {}
    except Exception:
        body = {}
    force_refresh = bool(body.get("force_refresh", False))
    # The requester is the authenticated user -- never trust a body-supplied
    # name. This username lands in the AI_ANALYSIS_REQUESTED audit entry.
    requested_by = current_user.username
    try:
        payload = analyze_log(db, log, requested_by=requested_by, force_refresh=force_refresh)
        return {"data": payload, "error": None}
    except Exception as e:
        return _error_response(500, "ANALYSIS_FAILED", str(e))


@router.get("/logs/{log_id}/analysis")
def get_analysis_endpoint(log_id: int, db: Session = Depends(get_db)):
    """Return the cached analysis for a log, if one has been generated."""
    log = db.query(models.AuditLog).filter(models.AuditLog.id == log_id).first()
    if not log:
        return _error_response(404, "LOG_NOT_FOUND", f"Audit log #{log_id} not found.")
    payload = get_cached_analysis(db, log)
    if payload is None:
        return _error_response(404, "NO_ANALYSIS",
                               "No analysis has been generated for this log yet.")
    return {"data": payload, "error": None}
