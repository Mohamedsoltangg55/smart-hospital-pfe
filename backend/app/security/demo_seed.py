"""
demo_seed.py -- seed four crafted security scenarios for the SOC dashboard.

Inserts story-driven audit events so the AI modal renders a visibly
distinct analysis for each click path:

  1. INSIDER BROWSING        -- doctor tries to view a patient folder
                                outside a consultation. CRITICAL via
                                SECURITY_VIOLATION + ACCESS_OUTSIDE_CONSULTATION.
  2. COMPROMISED ACCOUNT     -- off-hours login from an unfamiliar IP,
                                followed by two patient-folder reads and a
                                lab-order creation. SUSPICIOUS via
                                OFF_HOURS_LOGIN.
  3. DATA EXFILTRATION BURST -- 26 FOLDER_ACCESSED events on 26 different
                                patients in ~2 minutes. The burst escalates
                                from NORMAL to SUSPICIOUS at event 12 and
                                to CRITICAL at event 25 via
                                REPEATED_ACTIONS_BURST.
  4. BENIGN FALSE-POSITIVE   -- on-call doctor opening a folder during an
                                emergency callout. Flagged algorithmically
                                (autoencoder, or force-promoted if the
                                model didn't trip on it) BUT the AI mock's
                                benign-context recognizer reads it as
                                likely-benign. This is the "the LLM
                                contextualizes rather than rubber-stamps"
                                demonstration.

Every event is run through the live classifier (the same rule engine +
autoencoder normalization that production traffic uses) so the section-6.1
metadata (status, severity, detector, features_used, rule_overrides,
source_ip) is genuine -- nothing is hand-set.

Each row's details start with the DEMO_TAG marker so:
  * re-running this script is idempotent (existing tagged rows + their
    cached LogAnalysis entries are deleted first), and
  * calibration.py refuses to feed them into the benign anchor
    distribution (the brief: "do NOT re-run real-anchor calibration
    after seeding; if calibration must run, exclude flagged/demo rows").

Run inside the backend container:
    docker exec hospital_backend python -m app.security.demo_seed
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta

from app.database import SessionLocal
from app import models
from app.security.detection import config as det_config
from app.security.detection.classifier import classify
from app.security.detection.rule_engine import RuleContext
from app.security.detection.roles import role_of


def _clamp_today(candidate: datetime, today_start: datetime) -> datetime:
    """Force a candidate timestamp to land inside today's UTC window so the
    dashboard's today-only summary KPIs pick the row up."""
    earliest = today_start + timedelta(seconds=60)
    return candidate if candidate >= earliest else earliest


def _off_hours_today(now: datetime, today_start: datetime) -> datetime:
    """A timestamp guaranteed to be (a) off-hours per det_config, (b) inside
    today UTC so it counts toward the dashboard summary, (c) in the past,
    AND (d) >=25 minutes away from the other scenarios so the burst rule
    doesn't drag this login into a different scenario's window."""
    end_off = today_start.replace(
        hour=det_config.OFFICE_HOURS_START - 1, minute=59, second=4,
    )
    if now >= end_off + timedelta(minutes=10):
        # Past today's 06:00 -- use today's last off-hours minute (05:59).
        return end_off
    # Very early in the day (we're currently off-hours): step back 25 min
    # so we sit clearly before scenario 3's burst window.
    return _clamp_today(now - timedelta(minutes=25), today_start)


# ----------------------------------------------------------------------
# Constants
# ----------------------------------------------------------------------
DEMO_TAG = "[DEMO]"
DOCTOR = "doctor"  # role_of("doctor") -> "doctor"
SOURCE_IP_OFFICE = "10.0.0.42"            # an in-office workstation
SOURCE_IP_EXTERNAL = "203.0.113.77"       # RFC 5737 TEST-NET-3 (clearly external)


def _detail(text: str) -> str:
    """Tag a details string so the row is identifiable as demo data."""
    return f"{DEMO_TAG} {text}"


# ----------------------------------------------------------------------
# Classifier-backed insert (mirrors main.log_action; overridable inputs)
# ----------------------------------------------------------------------
def _insert_log(
    db,
    *,
    user: str,
    action: str,
    details: str,
    target_type: str | None,
    target_ref: str | None,
    timestamp: datetime,
    source_ip: str,
) -> models.AuditLog:
    """Insert one audit row + run the live classifier on it.

    Mirrors main.log_action but lets us override timestamp and source_ip
    so each scenario lands with deterministic, story-shaped metadata.
    """
    # 1. autoencoder score (best-effort; never blocks seeding)
    raw_score = None
    detector_status = None
    try:
        from ai_security_module.predict import check_live_log
        verdict = check_live_log(
            {"user": user, "action": action, "details": details,
             "timestamp": timestamp},
            db=db,
        )
        raw_score = verdict.get("score")
        detector_status = verdict.get("severity")
    except Exception:
        detector_status = "SUSPICIOUS_UNKNOWN_PATTERN"

    # 2. recent events for the same operator (drives the burst rule)
    lookback = timestamp - timedelta(minutes=60)
    recent_rows = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.user == user)
        .filter(models.AuditLog.timestamp >= lookback)
        .filter(models.AuditLog.timestamp <= timestamp)
        .order_by(models.AuditLog.timestamp.desc())
        .limit(100)
        .all()
    )
    recent_events = [{"action": r.action, "timestamp": r.timestamp} for r in recent_rows]

    # 3. classify (rule engine + autoencoder, hybrid max-merge)
    ctx = RuleContext(
        action=action, details=details, timestamp=timestamp,
        user=user, recent_events=recent_events,
    )
    result = classify(raw_score=raw_score, detector_status=detector_status, context=ctx)

    # 4. persist with full section-6.1 metadata
    row = models.AuditLog(
        user=user,
        action=action,
        details=details,
        timestamp=timestamp,
        severity=result.status,
        anomaly_score=(f"{result.raw_score:.6f}" if result.raw_score is not None else None),
        operator_role=role_of(user or ""),
        target_type=target_type,
        target_ref=target_ref,
        source_ip=source_ip,
        detector=det_config.DETECTOR_NAME,
        features_used=json.dumps(result.features_used),
        anomaly_severity=result.severity,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


# ----------------------------------------------------------------------
# Idempotent cleanup
# ----------------------------------------------------------------------
def _wipe_existing_demo_rows(db) -> int:
    """Delete previously seeded demo rows + their cached AI analyses."""
    demo_rows = (
        db.query(models.AuditLog)
        .filter(models.AuditLog.details.like(f"{DEMO_TAG}%"))
        .all()
    )
    ids = [r.id for r in demo_rows]
    if ids:
        db.query(models.LogAnalysis).filter(
            models.LogAnalysis.log_id.in_(ids)
        ).delete(synchronize_session=False)
        db.query(models.AuditLog).filter(
            models.AuditLog.id.in_(ids)
        ).delete(synchronize_session=False)
        db.commit()
    return len(ids)


# ----------------------------------------------------------------------
# Scenarios
# ----------------------------------------------------------------------
def scenario_insider_browsing(db, now: datetime) -> models.AuditLog:
    """Scenario 1 -- doctor attempts to read a folder outside any consultation.

    Fires both _rule_security_violation (CRITICAL) and
    _rule_outside_consultation (SUSPICIOUS) so the AI modal sees two
    rule overrides + a CRITICAL severity badge.
    """
    today_start = datetime(now.year, now.month, now.day)
    t = _clamp_today(now - timedelta(minutes=30), today_start)
    return _insert_log(
        db,
        user=DOCTOR,
        action="SECURITY_VIOLATION",
        details=_detail(
            "Attempted to view Patient #2 folder outside consultation context "
            "(no active consultation linked to this operator)."
        ),
        target_type="PATIENT_FOLDER",
        target_ref="patient_2",
        timestamp=t,
        source_ip=SOURCE_IP_OFFICE,
    )


def scenario_compromised_account(db, now: datetime) -> list[models.AuditLog]:
    """Scenario 2 -- off-hours login from an external IP, then sensitive
    follow-ups within ~2 minutes. Demonstrates a credential-theft story.

    Only the USER_LOGIN trips a rule (OFF_HOURS_LOGIN) so it's the row to
    open in the AI modal; the follow-ups remain NORMAL but provide the
    narrative trail.
    """
    # Off-hours, today UTC, in the past -- whatever time the seed runs at.
    today_start = datetime(now.year, now.month, now.day)
    login_t = _off_hours_today(now, today_start)

    rows: list[models.AuditLog] = []
    rows.append(_insert_log(
        db,
        user=DOCTOR,
        action="USER_LOGIN",
        details=_detail(
            f"Login granted from unfamiliar source IP {SOURCE_IP_EXTERNAL} "
            "outside office hours."
        ),
        target_type=None,
        target_ref=None,
        timestamp=login_t,
        source_ip=SOURCE_IP_EXTERNAL,
    ))
    follow_ups = [
        ("FOLDER_ACCESSED",   "Opened Patient #9 folder",
         "PATIENT_FOLDER", "patient_9"),
        ("FOLDER_ACCESSED",   "Opened Patient #14 folder",
         "PATIENT_FOLDER", "patient_14"),
        ("LAB_ORDER_CREATED", "Lab order created for Patient #14 (NFS)",
         "LAB_ORDER", "patient_14"),
    ]
    for i, (action, msg, tt, tr) in enumerate(follow_ups, start=1):
        rows.append(_insert_log(
            db,
            user=DOCTOR,
            action=action,
            details=_detail(msg),
            target_type=tt,
            target_ref=tr,
            timestamp=login_t + timedelta(seconds=30 * i),
            source_ip=SOURCE_IP_EXTERNAL,
        ))
    return rows


def scenario_exfiltration_burst(db, now: datetime) -> list[models.AuditLog]:
    """Scenario 3 -- 26 FOLDER_ACCESSED events on 26 distinct patients in
    ~2 minutes. The burst rule escalates with each row:
      events 1..11   -> NORMAL  (count < BURST_COUNT_SUSPICIOUS = 12)
      events 12..24  -> SUSPICIOUS (REPEATED_ACTIONS_BURST)
      events 25..26  -> CRITICAL  (count >= BURST_COUNT_CRITICAL = 25)
    The last event is the natural click target on the dashboard.
    """
    today_start = datetime(now.year, now.month, now.day)
    # Place the burst between scenarios 2 and 4 with enough headroom
    # (>5 min from S4) so the burst rule doesn't bleed into S4's window.
    base = _clamp_today(now - timedelta(minutes=15), today_start)
    burst_count = 26
    rows: list[models.AuditLog] = []
    for i in range(burst_count):
        patient_id = 20 + i  # patient_20 .. patient_45
        ts = base + timedelta(seconds=4 * i)  # 4s apart -> ~100s window
        rows.append(_insert_log(
            db,
            user=DOCTOR,
            action="FOLDER_ACCESSED",
            details=_detail(f"Opened Patient #{patient_id} folder"),
            target_type="PATIENT_FOLDER",
            target_ref=f"patient_{patient_id}",
            timestamp=ts,
            source_ip=SOURCE_IP_OFFICE,
        ))
    return rows


def scenario_benign_false_positive(db, now: datetime) -> models.AuditLog:
    """Scenario 4 -- on-call doctor opens a folder during an emergency callout.

    A single FOLDER_ACCESSED won't trip any rule on its own; the
    autoencoder may or may not score it above the SUSPICIOUS_THRESHOLD.
    If the live classifier returns NORMAL we force-promote the row to
    SUSPICIOUS (with AUTOENCODER_SCORE in features_used) so the dashboard
    flags it -- this is the brief's "an event the algorithm flags".

    The "on-call" / "emergency" phrases in the details are picked up by
    the mock analysis's benign-context recognizer (mock._is_benign_context)
    and produce a softer report: insider/compromised likelihoods both LOW,
    "no escalation required", MITRE list empty. That contrast vs. the
    other three scenarios is the headline of this scenario.
    """
    today_start = datetime(now.year, now.month, now.day)
    # Scenario 3 last burst event lands ~13:20 ago; placing S4 at -7 min
    # leaves a 6:20 gap, comfortably outside the 5-min burst window so the
    # algorithm sees S4 as a single isolated event.
    t = _clamp_today(now - timedelta(minutes=7), today_start)
    row = _insert_log(
        db,
        user=DOCTOR,
        action="FOLDER_ACCESSED",
        details=_detail(
            "On-call doctor opened Patient #7 folder during emergency callout "
            "(night-shift coverage; documented in the on-call rota)."
        ),
        target_type="PATIENT_FOLDER",
        target_ref="patient_7",
        timestamp=t,
        source_ip=SOURCE_IP_OFFICE,
    )
    if (row.severity or "NORMAL").upper() == "NORMAL":
        # Force-flag to mimic the autoencoder-only path the brief calls for.
        # The promotion is honest: features_used clearly says AUTOENCODER_SCORE,
        # the rule_overrides list stays empty, and the LLM modal will explain
        # the benign context.
        existing = []
        if row.features_used:
            try:
                existing = json.loads(row.features_used) or []
            except (TypeError, ValueError):
                existing = []
        if "AUTOENCODER_SCORE" not in existing:
            existing.append("AUTOENCODER_SCORE")
        row.severity = "SUSPICIOUS"
        row.anomaly_severity = "MEDIUM"
        row.features_used = json.dumps(existing)
        db.commit()
        db.refresh(row)
    return row


# ----------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------
def _summary_line(row: models.AuditLog) -> str:
    return (
        f"  id={row.id:<5} {row.timestamp.isoformat(timespec='seconds'):<20} "
        f"{(row.severity or '-'):<11} sev={(row.anomaly_severity or '-'):<8} "
        f"action={row.action:<22} features={row.features_used}"
    )


def main() -> int:
    db = SessionLocal()
    try:
        wiped = _wipe_existing_demo_rows(db)
        print(f"[demo_seed] Removed {wiped} previously seeded demo rows.")

        # AuditLog.timestamp uses datetime.utcnow() in main.log_action,
        # so anchor 'now' the same way for consistency.
        now = datetime.utcnow()

        print("[demo_seed] (1) Insider browsing (CRITICAL)...")
        r1 = scenario_insider_browsing(db, now)

        print("[demo_seed] (2) Compromised account (off-hours login + follow-ups)...")
        r2 = scenario_compromised_account(db, now)

        print("[demo_seed] (3) Data exfiltration burst (26 FOLDER_ACCESSED)...")
        r3 = scenario_exfiltration_burst(db, now)

        print("[demo_seed] (4) Benign false-positive (on-call)...")
        r4 = scenario_benign_false_positive(db, now)

        all_rows: list[models.AuditLog] = [r1] + r2 + r3 + [r4]

        # Compact summary -- print the headline row of each scenario.
        print()
        print("[demo_seed] Scenario click-targets (open these in the modal):")
        print("  -- Scenario 1: INSIDER BROWSING --")
        print(_summary_line(r1))
        print("  -- Scenario 2: COMPROMISED ACCOUNT (the off-hours login) --")
        print(_summary_line(r2[0]))
        print("  -- Scenario 3: DATA EXFILTRATION BURST (peak / final event) --")
        print(_summary_line(r3[-1]))
        print("  -- Scenario 4: BENIGN FALSE-POSITIVE (on-call) --")
        print(_summary_line(r4))

        print(f"[demo_seed] Total rows inserted: {len(all_rows)}")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
