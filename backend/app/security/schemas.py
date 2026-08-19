"""
schemas.py
----------
Pydantic models for the Security Audit Logs API (Phase 2).

Mirrors the section 6.1 audit-log contract and wraps every response in a
consistent { data, error } envelope.

NOTE: the database `severity` column holds the 3-tier STATUS
(NORMAL/SUSPICIOUS/CRITICAL); it is exposed here as `anomaly.status`. The
5-level `anomaly.severity` (INFO/LOW/MEDIUM/HIGH/CRITICAL) is a separate
column (`anomaly_severity`).
"""
from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field


class OperatorDTO(BaseModel):
    id: Optional[str] = None
    username: str
    role: Optional[str] = None


class TargetDTO(BaseModel):
    type: Optional[str] = None
    ref: Optional[str] = None


class AnomalyDTO(BaseModel):
    score: Optional[float] = None              # raw autoencoder reconstruction error
    status: str                                # NORMAL | SUSPICIOUS | CRITICAL
    severity: Optional[str] = None             # INFO | LOW | MEDIUM | HIGH | CRITICAL
    detector: Optional[str] = None
    rule_overrides: List[str] = Field(default_factory=list)
    features_used: List[str] = Field(default_factory=list)


class AuditLogDTO(BaseModel):
    id: str
    timestamp: Optional[str] = None
    operator: OperatorDTO
    action_type: Optional[str] = None
    event_details: Optional[str] = None
    target: Optional[TargetDTO] = None
    source_ip: Optional[str] = None
    anomaly: AnomalyDTO


class PageMeta(BaseModel):
    page: int
    page_size: int
    total: int
    total_pages: int


class LogsData(BaseModel):
    items: List[AuditLogDTO]
    page: PageMeta


class SummaryData(BaseModel):
    total_events: int
    security_violations: int
    ai_anomalies: int
    user_connections: int


class ErrorDTO(BaseModel):
    code: str
    message: str


class LogsEnvelope(BaseModel):
    """{ data, error } — exactly one side is populated."""
    data: Optional[LogsData] = None
    error: Optional[ErrorDTO] = None


class SummaryEnvelope(BaseModel):
    data: Optional[SummaryData] = None
    error: Optional[ErrorDTO] = None
