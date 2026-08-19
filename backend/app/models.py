from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text
from .database import Base

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String)
    role = Column(String)
    full_name = Column(String, nullable=True)
    date_of_birth = Column(String, nullable=True)
    specialty = Column(String, nullable=True)
    phone = Column(String, nullable=True)
    is_online = Column(Boolean, default=False)
    room_number = Column(String, nullable=True)

class Patient(Base):
    __tablename__ = "patients"
    id = Column(Integer, primary_key=True, index=True)
    first_name = Column(String)
    last_name = Column(String)
    date_of_birth = Column(String)
    gender = Column(String)
    phone = Column(String, nullable=True)
    wilaya = Column(String, nullable=True)
    nss = Column(String, nullable=True)

class Appointment(Base):
    __tablename__ = "appointments"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer)
    doctor_id = Column(Integer)
    scheduled_time = Column(String)
    status = Column(String, default="Waiting")
    priority = Column(String, default="Standard")
    service = Column(String)
    appointment_type = Column(String, default="Walk-In")
    ticket_number = Column(String, nullable=True)
    diagnosis = Column(String, nullable=True)
    treatment = Column(String, nullable=True)
    payment_status = Column(String, default="Unpaid")

class SystemSettings(Base):
    __tablename__ = "settings"
    id = Column(Integer, primary_key=True, index=True)
    hospital_name = Column(String, default="Clinique Smart")
    tv_announcement = Column(String, default="Bienvenue")
    services = Column(String, default="[]")
    rooms = Column(String, default="[]")  # 🚨 LA COLONNE VITALE POUR STOCKER
    prices = Column(String, default="[]") # 🚨 LA COLONNE VITALE POUR STOCKER

class Hospitalization(Base):
    __tablename__ = "hospitalizations"
    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer)
    patient_name = Column(String)
    department = Column(String)
    room_name = Column(String)
    bed_number = Column(String)
    admission_date = Column(String)
    discharge_date = Column(String, nullable=True)
    status = Column(String, default="Occupied")
    doctor_id = Column(Integer, nullable=True, index=True)
    doctor_name = Column(String, nullable=True)

class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, index=True)
    user = Column(String)
    action = Column(String)
    details = Column(String)
    timestamp = Column(DateTime)
    severity = Column(String, default="NORMAL")  # 3-tier STATUS: NORMAL | SUSPICIOUS | CRITICAL
    anomaly_score = Column(String, nullable=True)  # raw reconstruction error (stringified)
    # --- Phase 2 (decision C): additive, nullable columns for the 6.1 schema ---
    operator_role = Column(String, nullable=True)     # role derived from username
    target_type = Column(String, nullable=True)       # e.g. PATIENT_FOLDER
    target_ref = Column(String, nullable=True)        # e.g. patient_2
    source_ip = Column(String, nullable=True)         # captured via middleware
    detector = Column(String, nullable=True)          # detector identity
    features_used = Column(String, nullable=True)     # JSON list of fired rules
    anomaly_severity = Column(String, nullable=True)  # INFO|LOW|MEDIUM|HIGH|CRITICAL

class LogAnalysis(Base):
    """Phase 3: per-log cache of the LLM contextual analysis (section 6.2).
    One row per audit log; re-analyze overwrites it."""
    __tablename__ = "log_analyses"
    id = Column(Integer, primary_key=True, index=True)
    log_id = Column(Integer, index=True, unique=True)
    model = Column(String)
    generated_at = Column(DateTime)
    status = Column(String)          # ok | fallback | mock
    analysis_json = Column(String)   # the section 4 report, JSON-encoded
    requested_by = Column(String)

class NursingTask(Base):
    __tablename__ = "nursing_tasks"
    id = Column(Integer, primary_key=True, index=True)
    patient_name = Column(String)
    task_description = Column(String)
    room_number = Column(String)
    status = Column(String, default="Pending")
    created_at = Column(DateTime)
    completed_by = Column(String, nullable=True)

class InventoryItem(Base):
    __tablename__ = "inventory"
    id = Column(Integer, primary_key=True, index=True)
    item_name = Column(String)
    quantity = Column(Integer)


class LabOrder(Base):
    """
    Created by a doctor during consultation.
    Status lifecycle:  Ordered → In Progress → Completed → Validated
    """
    __tablename__ = "lab_orders"
 
    id              = Column(Integer, primary_key=True, index=True)
    patient_id      = Column(Integer, index=True)       # FK → patients.id
    doctor_id       = Column(Integer, index=True)       # FK → users.id
    doctor_name     = Column(String, nullable=True)
 
    # Which test was ordered (e.g. "NFS", "Glycémie", "CRP")
    test_name       = Column(String)
    test_category   = Column(String)                    # Hématologie / Biochimie / Microbiologie / Sérologie / Autre
    clinical_notes  = Column(Text, nullable=True)       # Doctor's instruction to the lab
    urgency         = Column(String, default="Normal")  # Normal / Urgent / STAT
 
    # Lifecycle
    status          = Column(String, default="Ordered") # Ordered / In Progress / Completed / Validated
    ordered_at      = Column(DateTime)
    completed_at    = Column(DateTime, nullable=True)
 
    # Lab technician who processed the order
    lab_tech_name   = Column(String, nullable=True)
    payment_status = Column(String, default="Unpaid")
 
    # Appointment the order was created from (optional link)
    appointment_id  = Column(Integer, nullable=True)
 
 
class LabResult(Base):
    """
    One row per parameter inside a LabOrder.
    e.g.  NFS order → 8 result rows (GB, GR, Hb, Hte, Plaquettes…)
    """
    __tablename__ = "lab_results"
 
    id          = Column(Integer, primary_key=True, index=True)
    order_id    = Column(Integer, index=True)           # FK → lab_orders.id
 
    # The measured parameter
    parameter   = Column(String)                        # e.g. "Hémoglobine"
    value       = Column(String)                        # stored as string to support "<0.1", "Positif", etc.
    unit        = Column(String, nullable=True)         # e.g. "g/dL"
    ref_min     = Column(String, nullable=True)         # normal range minimum
    ref_max     = Column(String, nullable=True)         # normal range maximum
    flag        = Column(String, nullable=True)         # "H" (High) | "L" (Low) | "N" (Normal) | "!" (Critical)    