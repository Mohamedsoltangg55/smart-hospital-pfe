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
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ..database import get_db
from .. import models
from .detection.roles import role_of
from .schemas import (
    AnomalyDTO, AuditLogDTO, ErrorDTO, LogsData, LogsEnvelope,
    OperatorDTO, PageMeta, SummaryData, SummaryEnvelope, TargetDTO,
)

# ======================================================================
#  TODO(Phase 5 - hardening): protect EVERY route in this router with
#  require_role("admin", "security_officer"). Audit/security data must NOT
#  remain unauthenticated -- enforce on the backend, not just in the UI.
#  e.g.  dependencies=[Depends(require_role("admin", "security_officer"))]
# ======================================================================

router = APIRouter(prefix="/api/security", tags=["security"])

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
