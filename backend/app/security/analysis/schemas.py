"""
schemas.py -- Pydantic models for the section 4 LLM analysis contract.

Parsing an LLM response dict into `AnalysisReport` IS the schema-validation
step: service.py retries once, then falls back, when validation fails.
"""
from __future__ import annotations

from typing import List

from pydantic import BaseModel, Field

CANON_DISCLAIMER = "AI-generated decision support; not a substitute for human review."


class Likelihood(BaseModel):
    likelihood: str          # LOW | MEDIUM | HIGH
    reasoning: str


class SeverityAssessment(BaseModel):
    level: str               # INFO | LOW | MEDIUM | HIGH | CRITICAL
    explanation: str


class AnalysisReport(BaseModel):
    """The section 4 structured cybersecurity report returned by the LLM."""
    incident_summary: str
    why_suspicious: str
    security_risks: List[str]
    insider_threat: Likelihood
    compromised_account: Likelihood
    recommended_mitigations: List[str]
    recommended_admin_response: List[str]
    severity: SeverityAssessment
    confidence: str          # LOW | MEDIUM | HIGH
    mitre_attack_refs: List[str] = Field(default_factory=list)
    disclaimer: str = CANON_DISCLAIMER
