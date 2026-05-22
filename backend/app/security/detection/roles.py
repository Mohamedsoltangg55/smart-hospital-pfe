"""
roles.py -- lightweight, deterministic role inference from a username.

Mirrors the role bucketing used by the autoencoder preprocessor, but without
the pandas/scikit-learn dependency so the rule engine stays cheap to import.
Phase 2 will persist the operator role on the AuditLog row (decision C); until
then the detection layer derives it on the fly from the username prefix.
"""
from __future__ import annotations

ROLE_DOCTOR = "doctor"
ROLE_NURSE = "nurse"
ROLE_RECEPTION = "reception"
ROLE_CASHIER = "cashier"
ROLE_LAB = "lab"
ROLE_ADMIN = "admin"
ROLE_OTHER = "other"


def role_of(username: str) -> str:
    """Infer a coarse role bucket from a username prefix."""
    if not isinstance(username, str):
        return ROLE_OTHER
    u = username.strip().lower()
    if u.startswith("dr_") or u.startswith("dr.") or u.startswith("doctor"):
        return ROLE_DOCTOR
    if u.startswith("nurse") or u.startswith("inf"):
        return ROLE_NURSE
    if u.startswith("reception"):
        return ROLE_RECEPTION
    if u.startswith("cashier") or u.startswith("caisse"):
        return ROLE_CASHIER
    if u.startswith("lab"):
        return ROLE_LAB
    if "admin" in u:
        return ROLE_ADMIN
    return ROLE_OTHER
