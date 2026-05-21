from pydantic import BaseModel
from typing import Optional
from typing import Optional, List

class UserCreate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None
    full_name: Optional[str] = None
    date_of_birth: Optional[str] = None
    specialty: Optional[str] = None
    phone: Optional[str] = None

class PatientCreate(BaseModel):
    first_name: str
    last_name: str
    date_of_birth: str
    gender: str
    phone: Optional[str] = None
    wilaya: Optional[str] = None
    nss: Optional[str] = None
    user: Optional[str] = None

class AppointmentCreate(BaseModel):
    patient_id: int
    doctor_id: Optional[int] = None
    scheduled_time: str
    priority: str
    service: str
    appointment_type: str
    user: Optional[str] = None

class StatusUpdate(BaseModel):
    status: Optional[str] = None
    payment_status: Optional[str] = None

class ConsultationUpdate(BaseModel):
    diagnosis: str
    treatment: str
    user: Optional[str] = None

class HospitalizationCreate(BaseModel):
    patient_id: int
    patient_name: str
    department: str
    room_name: str
    bed_number: str
    admission_date: str
    doctor_id: Optional[int] = None
    doctor_name: Optional[str] = None

class SettingsUpdate(BaseModel):
    hospital_name: Optional[str] = None
    tv_announcement: Optional[str] = None
    services: Optional[str] = None
    rooms: Optional[str] = None   # 🚨 THE FIX IS HERE (Ouvre la porte aux salles)
    prices: Optional[str] = None  # 🚨 THE FIX IS HERE (Ouvre la porte aux prix)

class RoomsUpdate(BaseModel):
    rooms: str

class NursingTaskCreate(BaseModel):
    patient_name: str
    task_description: str
    room_number: str
    status: str

class NursingTaskUpdate(BaseModel):
    status: str
    completed_by: Optional[str] = None


## ─── ADD THESE CLASSES TO YOUR EXISTING schemas.py ─────────────────────────

class LabResultInput(BaseModel):
    """A single measured parameter submitted by the lab technician."""
    parameter : str
    value     : str
    unit      : Optional[str] = None
    ref_min   : Optional[str] = None
    ref_max   : Optional[str] = None
    flag      : Optional[str] = None   # "H" | "L" | "N" | "!"


class LabOrderCreate(BaseModel):
    """Payload sent by the doctor when ordering a lab test."""
    patient_id     : int
    doctor_id      : int
    doctor_name    : Optional[str] = None
    test_name      : str
    test_category  : str
    clinical_notes : Optional[str] = None
    urgency        : Optional[str] = "Normal"
    appointment_id : Optional[int] = None
    user           : Optional[str] = None   # for audit log


class LabResultsSubmit(BaseModel):
    """
    Payload sent by the lab technician when completing an order.
    Contains the full list of measured parameters.
    """
    lab_tech_name : Optional[str] = None
    results       : List[LabResultInput]    