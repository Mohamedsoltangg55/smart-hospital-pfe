import os
import json
from web3 import Web3
from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect, BackgroundTasks, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm, HTTPBearer
from sqlalchemy.orm import Session
from sqlalchemy import text, inspect
from datetime import datetime
from . import models, schemas
from .database import engine, get_db
from .auth import get_password_hash, verify_password, create_access_token
from .websocket_manager import manager
from jose import jwt, JWTError
from .auth import SECRET_KEY, ALGORITHM
import hashlib

# --- 🔗 LOCAL BLOCKCHAIN CONFIGURATION (GANACHE) ---
GANACHE_URL = "http://host.docker.internal:7545"
w3 = Web3(Web3.HTTPProvider(GANACHE_URL))


GANACHE_URL     = os.getenv("GANACHE_URL",     "http://host.docker.internal:7545")
WALLET_ADDRESS  = os.getenv("WALLET_ADDRESS",  "")
PRIVATE_KEY     = os.getenv("PRIVATE_KEY",     "")
CONTRACT_ADDRESS = os.getenv("CONTRACT_ADDRESS", "")


# Paste your Remix ABI array between the brackets below
CONTRACT_ABI = json.loads('''[
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "uint256",
				"name": "appointmentId",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "string",
				"name": "hashValue",
				"type": "string"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "timestamp",
				"type": "uint256"
			}
		],
		"name": "RecordSecured",
		"type": "event"
	},
	{
		"inputs": [
			{
				"internalType": "uint256",
				"name": "_appointmentId",
				"type": "uint256"
			},
			{
				"internalType": "string",
				"name": "_hashValue",
				"type": "string"
			}
		],
		"name": "secureRecord",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "uint256",
				"name": "_appointmentId",
				"type": "uint256"
			}
		],
		"name": "getRecordHash",
		"outputs": [
			{
				"internalType": "string",
				"name": "",
				"type": "string"
			}
		],
		"stateMutability": "view",
		"type": "function"
	}
]''') 



# Initialize the contract safely
try:
    if CONTRACT_ADDRESS and CONTRACT_ABI:
        medical_contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=CONTRACT_ABI)
    else:
        medical_contract = None
except Exception as e:
    print(f"⚠️ Blockchain configuration error: {e}")
    medical_contract = None
# --------------------------------------------------

models.Base.metadata.create_all(bind=engine)


def ensure_user_date_of_birth_column():
    inspector = inspect(engine)
    user_columns = {column["name"] for column in inspector.get_columns("users")}
    if "date_of_birth" in user_columns:
        return

    if engine.dialect.name == "sqlite":
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE users ADD COLUMN date_of_birth VARCHAR"))
    else:
        with engine.begin() as connection:
            connection.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth VARCHAR"))


ensure_user_date_of_birth_column()


def ensure_appointment_payment_status_column():
    inspector = inspect(engine)
    appt_columns = {column["name"] for column in inspector.get_columns("appointments")}
    if "payment_status" in appt_columns:
        return
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            connection.execute(text("ALTER TABLE appointments ADD COLUMN payment_status VARCHAR DEFAULT 'Unpaid'"))
        else:
            connection.execute(text("ALTER TABLE appointments ADD COLUMN IF NOT EXISTS payment_status VARCHAR DEFAULT 'Unpaid'"))


ensure_appointment_payment_status_column()


def ensure_audit_log_severity_columns():
    """Add AI security severity fields to existing audit_logs tables."""
    inspector = inspect(engine)
    log_columns = {column["name"] for column in inspector.get_columns("audit_logs")}
    if "severity" in log_columns and "anomaly_score" in log_columns:
        return
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            if "severity" not in log_columns:
                connection.execute(text("ALTER TABLE audit_logs ADD COLUMN severity VARCHAR DEFAULT 'NORMAL'"))
            if "anomaly_score" not in log_columns:
                connection.execute(text("ALTER TABLE audit_logs ADD COLUMN anomaly_score VARCHAR"))
        else:
            connection.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS severity VARCHAR DEFAULT 'NORMAL'"))
            connection.execute(text("ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS anomaly_score VARCHAR"))


ensure_audit_log_severity_columns()

app = FastAPI(title="Smart Hospital API")

# ✅ CORS restricted to allowed origins only
allowed_origins = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:3000,http://frontend:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# ✅ Add security headers
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    return response

# ✅ HEALTH CHECK ENDPOINT for Docker
@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    """Health check endpoint for Docker healthcheck and K8s readiness probe"""
    try:
        # Verify DB connection by executing a simple query
        db.execute(text("SELECT 1"))
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "database": "disconnected", "error": str(e)}

# 🔌 WEBSOCKET ENDPOINTS FOR REAL-TIME UPDATES
@app.websocket("/ws/appointments/{doctor_id}")
async def websocket_appointments(websocket: WebSocket, doctor_id: int, db: Session = Depends(get_db)):
    """Real-time appointment queue updates for a specific doctor"""
    user_id = str(doctor_id)
    await manager.connect(websocket, user_id)
    try:
        while True:
            # Keep connection alive and listen for messages
            data = await websocket.receive_text()
            # Optional: handle incoming messages from client (e.g., refresh requests)
            if data == "refresh":
                appointments = db.query(models.Appointment, models.Patient).join(
                    models.Patient, models.Appointment.patient_id == models.Patient.id
                ).filter(
                    models.Appointment.doctor_id == doctor_id,
                    models.Appointment.status.in_(["Waiting", "In Progress"])
                ).all()
                
                message = {
                    "type": "appointment_update",
                    "doctor_id": doctor_id,
                    "appointments": [
                        {
                            "appointment": {
                                "id": r.Appointment.id,
                                "ticket_number": r.Appointment.ticket_number,
                                "status": r.Appointment.status,
                                "priority": r.Appointment.priority
                            },
                            "patient": {
                                "id": r.Patient.id,
                                "first_name": r.Patient.first_name,
                                "last_name": r.Patient.last_name
                            }
                        } for r in appointments
                    ]
                }
                await websocket.send_json(message)
    except WebSocketDisconnect:
        await manager.disconnect(websocket, user_id)
        print(f"Doctor {doctor_id} disconnected from appointments")

@app.websocket("/ws/hospitalizations")
async def websocket_hospitalizations(websocket: WebSocket):
    """Real-time bed occupancy updates for all clients"""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "refresh":
                db = next(get_db())
                try:
                    hospitalizations = db.query(models.Hospitalization).filter(
                        models.Hospitalization.status == "Occupied"
                    ).all()

                    message = {
                        "type": "hospitalization_update",
                        "hospitalizations": [
                            {
                                "id": h.id,
                                "patient_name": h.patient_name,
                                "room_name": h.room_name,
                                "bed_number": h.bed_number,
                                "department": h.department,
                                "status": h.status
                            } for h in hospitalizations
                        ]
                    }
                    await websocket.send_json(message)
                finally:
                    db.close()
    
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
        print("Client disconnected from hospitalizations")

@app.websocket("/ws/doctors-status")
async def websocket_doctors_status(websocket: WebSocket):
    """Real-time doctor online/offline status updates"""
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "refresh":
                db = next(get_db())
                doctors = db.query(models.User).filter(models.User.role == "doctor").all()
                await websocket.send_json({
                    "type": "doctors_update",
                    "doctors": [{
                        "id": d.id,
                        "username": d.username,
                        "is_online": d.is_online,
                        "room_number": d.room_number
                    } for d in doctors]
                })
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
        print("Client disconnected from doctors status")

@app.websocket("/ws/tv")
async def websocket_tv(websocket: WebSocket):
    """Real-time updates specifically for global TV dashboards"""
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
            # Just keep connection alive
    except WebSocketDisconnect:
        await manager.disconnect(websocket)
        print("TV client disconnected")
        print("Client disconnected from doctor status")

# ✅ JWT dependency for protected routes - Simplified
async def get_current_user(request: Request, db: Session = Depends(get_db)):
    """Extract and validate JWT token from Authorization header"""
    auth_header = request.headers.get("Authorization")
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing authorization header")
    
    # Format: "Bearer <token>"
    try:
        scheme, token = auth_header.split()
        if scheme.lower() != "bearer":
            raise HTTPException(status_code=401, detail="Invalid authorization scheme")
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid authorization header format")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ✅ RBAC dependency factory
def require_role(*allowed_roles):
    async def check_role(current_user: models.User = Depends(get_current_user)):
        if current_user.role not in allowed_roles:
            raise HTTPException(status_code=403, detail=f"Access denied. Required role: {', '.join(allowed_roles)}")
        return current_user
    return check_role

# --- 🛡️ THE AUDIT LOGGER ---
def log_action(db: Session, user: str, action: str, details: str):
    now = datetime.utcnow()

    # 🧠 ALGORITHMIC SECURITY LAYER (non-LLM): score the event with the
    # autoencoder, then classify it into a NORMAL / SUSPICIOUS / CRITICAL
    # status via the detection layer. Failures here never break audit logging.
    raw_score = None
    detector_status = None
    try:
        from ai_security_module.predict import check_live_log
        verdict = check_live_log(
            {"user": user, "action": action, "details": details, "timestamp": now},
            db=db,
        )
        raw_score = verdict.get("score")
        detector_status = verdict.get("severity")
    except Exception as e:
        detector_status = "SUSPICIOUS_UNKNOWN_PATTERN"
        print(f"AI security hook error: {e}")

    status = "NORMAL"
    score_str = None
    try:
        from datetime import timedelta
        from .security.detection.classifier import classify
        from .security.detection.rule_engine import RuleContext

        # Recent events by the same operator -> feeds the burst rule.
        recent_events = []
        try:
            lookback = now - timedelta(minutes=60)
            recent_rows = (
                db.query(models.AuditLog)
                .filter(models.AuditLog.user == user)
                .filter(models.AuditLog.timestamp >= lookback)
                .order_by(models.AuditLog.timestamp.desc())
                .limit(100)
                .all()
            )
            recent_events = [
                {"action": r.action, "timestamp": r.timestamp} for r in recent_rows
            ]
        except Exception:
            recent_events = []

        ctx = RuleContext(
            action=action, details=details, timestamp=now,
            user=user, recent_events=recent_events,
        )
        result = classify(raw_score=raw_score, detector_status=detector_status, context=ctx)
        status = result.status
        if result.raw_score is not None:
            score_str = f"{result.raw_score:.6f}"
    except Exception as e:
        # The detection layer must never break audit logging.
        status = "SUSPICIOUS" if (detector_status and "UNKNOWN" in detector_status) else "NORMAL"
        if raw_score is not None:
            score_str = f"{raw_score:.6f}"
        print(f"Detection classifier error: {e}")

    try:
        new_log = models.AuditLog(
            user=user if user else "System",
            action=action,
            details=details,
            timestamp=now,
            severity=status,
            anomaly_score=score_str,
        )
        db.add(new_log)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Log Error: {e}")

# --- 👥 USERS & AUTH ---
@app.post("/register")
def register_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    if not payload.username or not payload.password:
        raise HTTPException(status_code=400, detail="Username and password are required")
    
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username exists")
    new_user = models.User(
        username=payload.username,
        password=get_password_hash(payload.password),  # ✅ HASH PASSWORD
        role=payload.role.lower() if payload.role else "doctor",
        full_name=payload.full_name,
        date_of_birth=payload.date_of_birth,
        specialty=payload.specialty,
        phone=payload.phone
    )
    db.add(new_user)
    db.commit()
    log_action(db, "System", "USER_CREATED", f"Created new account: {payload.username} ({new_user.role})")
    return {"msg": "User registered successfully"}

@app.post("/token")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.username == form_data.username).first()
    
    # ✅ Use password verification instead of plaintext comparison
    if not user or not verify_password(form_data.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    log_action(db, user.username, "USER_LOGIN", f"Access granted for role: {user.role}")
    
    # ✅ Return real JWT token instead of username
    access_token = create_access_token(data={"sub": user.username, "role": user.role})
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "role": user.role,
        "userId": user.id 
    }

@app.get("/users/")
def get_users(db: Session = Depends(get_db), current_user: models.User = Depends(get_current_user)):
    # Any authenticated user can see the user list (needed for reception to see doctors)
    return db.query(models.User).all()

@app.get("/users/min")
def get_users_public(db: Session = Depends(get_db)):
    """Return minimal user info (public endpoint for reception/triage to list doctors)"""
    users = db.query(models.User).all()
    return [
        {
            "id": u.id,
            "username": u.username,
            "role": u.role,
            "specialty": u.specialty,
            "is_online": u.is_online,
            "room_number": u.room_number
        } for u in users
    ]

@app.post("/users/")
def create_user(
    payload: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin"))
):
    if not payload.username or not payload.password or not payload.role:
        raise HTTPException(status_code=400, detail="Username, password, and role are required")
    
    existing = db.query(models.User).filter(models.User.username == payload.username).first()
    if existing:
        raise HTTPException(status_code=400, detail="Username already exists")
    
    new_user = models.User(
        username=payload.username,
        password=get_password_hash(payload.password),  # ✅ HASH PASSWORD
        role=payload.role.lower(),
        specialty=payload.specialty,
        full_name=payload.full_name,
        date_of_birth=payload.date_of_birth,
        phone=payload.phone 
    )
    db.add(new_user)
    db.commit()
    log_action(db, current_user.username, "USER_CREATED", f"Created user: {payload.username}")
    return {"msg": f"User {payload.username} created successfully", "id": new_user.id}

@app.get("/doctors")
def get_doctors(db: Session = Depends(get_db)):
    return db.query(models.User).filter(models.User.role == "doctor").all()

@app.patch("/users/{user_id}")
def update_user(
    user_id: int,
    payload: schemas.UserCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin"))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update fields
    if payload.username and payload.username != user.username:
        existing = db.query(models.User).filter(models.User.username == payload.username).first()
        if existing:
            raise HTTPException(status_code=400, detail="Username already exists")
        user.username = payload.username
    
    if payload.full_name:
        user.full_name = payload.full_name
    if payload.specialty:
        user.specialty = payload.specialty
    if payload.phone:
        user.phone = payload.phone
    if payload.date_of_birth:
        user.date_of_birth = payload.date_of_birth
    if payload.role:
        user.role = payload.role.lower()
    if payload.password:
        user.password = get_password_hash(payload.password)
    
    db.commit()
    log_action(db, current_user.username, "USER_UPDATED", f"Updated user: {user.username}")
    return {"msg": "User updated successfully"}

@app.delete("/users/{user_id}")
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_role("admin"))
):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if user.id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")
    
    username = user.username
    db.delete(user)
    db.commit()
    log_action(db, current_user.username, "USER_DELETED", f"Deleted user: {username}")
    return {"msg": "User deleted successfully"}

# --- 🩺 DOCTORS & NURSES STATUS ---
@app.get("/doctor/queue/{doctor_id}")
def get_doctor_queue(doctor_id: int, db: Session = Depends(get_db)):
    records = db.query(models.Appointment, models.Patient).join(
        models.Patient, models.Appointment.patient_id == models.Patient.id
    ).filter(
        models.Appointment.doctor_id == doctor_id,
        models.Appointment.status.in_(["Waiting", "In Progress"])
    ).all()
    
    return [{"appointment": r.Appointment, "patient": r.Patient} for r in records]


@app.patch("/doctors/{doctor_id}/status")
def update_doctor_status(doctor_id: int, background_tasks: BackgroundTasks, is_online: bool = False, room_number: str = None, db: Session = Depends(get_db)):
    doctor = db.query(models.User).filter(models.User.id == doctor_id).first()
    if not doctor:
        return {"error": "Doctor not found"}
    
    # Parse is_online from string if needed (query params are strings)
    if isinstance(is_online, str):
        is_online = is_online.lower() in ('true', '1', 'yes')
    
    doctor.is_online = is_online
    doctor.room_number = room_number if is_online else None 
    db.commit()
    db.refresh(doctor)  # Refresh to ensure latest data
    
    status_text = "ONLINE" if is_online else "OFFLINE"
    log_action(db, doctor.username, "STATUS_CHANGED", f"Doctor went {status_text} in {room_number or 'No Room'}")
    
    # 🔌 BROADCAST: Doctor status changed (online/offline)
    background_tasks.add_task(manager.broadcast, {
        "type": "doctor_status_changed",
        "doctor_id": doctor.id,
        "username": doctor.username,
        "is_online": doctor.is_online,
        "room_number": doctor.room_number
    })
    
    return {"msg": f"Doctor status updated to {status_text}", "is_online": doctor.is_online, "room_number": doctor.room_number}

@app.patch("/nurses/{nurse_id}/status")
def update_nurse_status(nurse_id: int, is_online: bool, room_number: str = None, db: Session = Depends(get_db)): 
    nurse = db.query(models.User).filter(models.User.id == nurse_id).first()
    if not nurse: return {"error": "Nurse not found"}
    
    nurse.is_online = is_online
    nurse.room_number = room_number if is_online else None 
    db.commit()
    
    status_text = "ONLINE" if is_online else "OFFLINE"
    log_action(db, nurse.username, "NURSE_STATUS", f"Infirmier went {status_text} in {room_number or 'No Room'}")
    return {"msg": "Nurse status updated"}


# --- 🏥 PATIENTS & MEDICAL FOLDERS ---
@app.post("/patients/")
def create_patient(payload: schemas.PatientCreate, db: Session = Depends(get_db)):
    new_patient = models.Patient(
        first_name=payload.first_name, 
        last_name=payload.last_name, 
        date_of_birth=payload.date_of_birth, 
        phone=payload.phone,
        gender=payload.gender,
        wilaya=payload.wilaya,
        nss=payload.nss
    )
    db.add(new_patient)
    db.commit()
    db.refresh(new_patient)
    log_action(db, payload.user, "PATIENT_REGISTERED", f"Added Patient #{new_patient.id} - NSS: {new_patient.nss}")
    return new_patient

@app.get("/patients/")
def get_patients(db: Session = Depends(get_db)):
    return db.query(models.Patient).all()

@app.get("/patients/{patient_id}/folder")
def get_secure_health_folder(patient_id: int, role: str, doctor_username: str = None, db: Session = Depends(get_db)):
    # SECURITY LOCK
    if role == "doctor":
        doctor = db.query(models.User).filter(models.User.username == doctor_username).first()
        if not doctor:
            raise HTTPException(status_code=404, detail="Doctor not found")

        is_in_office = db.query(models.Appointment).filter(
            models.Appointment.patient_id == patient_id,
            models.Appointment.doctor_id == doctor.id,
            models.Appointment.status == "In Progress"
        ).first()

        if not is_in_office:
            log_action(db, doctor_username, "SECURITY_VIOLATION", f"Attempted to view Patient #{patient_id} folder outside consultation")
            raise HTTPException(status_code=403, detail="ACCESS DENIED: Patient is not currently in your office.")
        
        log_action(db, doctor_username, "FOLDER_ACCESSED", f"Doctor opened folder for active Patient #{patient_id}")
    elif role == "admin":
        log_action(db, "admin", "FOLDER_ACCESSED", f"Admin opened master folder for Patient #{patient_id}")
    else:
        raise HTTPException(status_code=403, detail="Unauthorized role")

    # FETCH ENRICHED DATA
    records = db.query(
        models.Appointment,
        models.User.username.label("doctor_name"),
        models.User.specialty.label("doctor_specialty")
    ).join(models.User, models.Appointment.doctor_id == models.User.id).filter(
        models.Appointment.patient_id == patient_id,
        models.Appointment.status == "Completed"
    ).order_by(models.Appointment.scheduled_time.desc()).all()

    return [
        {
            "id": row.Appointment.id,
            "scheduled_time": row.Appointment.scheduled_time,
            "diagnosis": row.Appointment.diagnosis,
            "treatment": row.Appointment.treatment,
            "service": row.Appointment.service,
            "doctor_name": row.doctor_name,
            "doctor_specialty": row.doctor_specialty
        } for row in records
    ]


# --- 📅 APPOINTMENTS & TRIAGE ---
@app.post("/appointments/")
def create_appointment(payload: schemas.AppointmentCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    target_date = payload.scheduled_time[:10]
    daily_count = db.query(models.Appointment).filter(
        models.Appointment.appointment_type == payload.appointment_type,
        models.Appointment.scheduled_time.like(f"{target_date}%")
    ).count()
    
    new_number = daily_count + 1
    
    generated_ticket = None
    if payload.appointment_type == "Emergency":
        generated_ticket = f"URG-{new_number:03d}"
    elif payload.appointment_type == "Walk-In":
        generated_ticket = f"STD-{new_number:03d}"
    elif payload.appointment_type == "Scheduled":
        generated_ticket = f"RDV-{new_number:03d}"
    else:
        generated_ticket = f"TKT-{new_number:03d}"

    new_appt = models.Appointment(
        patient_id=payload.patient_id,
        doctor_id=payload.doctor_id,
        scheduled_time=payload.scheduled_time,
        priority=payload.priority,
        status="Waiting",
        service=payload.service,
        appointment_type=payload.appointment_type,
        ticket_number=generated_ticket
    )
    db.add(new_appt)
    db.commit()
    db.refresh(new_appt)
    
    log_action(db, payload.user, f"TRIAGE_{payload.appointment_type.upper()}", f"Patient #{payload.patient_id} assigned Ticket {generated_ticket}")
    
    # 🔌 BROADCAST: New appointment created
    background_tasks.add_task(manager.broadcast, {
        "type": "new_appointment",
        "doctor_id": payload.doctor_id,
        "ticket_number": generated_ticket,
        "patient_id": payload.patient_id,
        "appointment_id": new_appt.id
    })
    
    # 🔁 Broadcast canonical doctor queue update (full shape) to ensure clients have consistent data
    if payload.doctor_id is not None:
        try:
            records = db.query(models.Appointment, models.Patient).join(
                models.Patient, models.Appointment.patient_id == models.Patient.id
            ).filter(
                models.Appointment.doctor_id == payload.doctor_id,
                models.Appointment.status.in_(["Waiting", "In Progress"])
            ).all()

            appointments_payload = [
                {
                    "appointment": {
                        "id": r.Appointment.id,
                        "ticket_number": r.Appointment.ticket_number,
                        "status": r.Appointment.status,
                        "priority": r.Appointment.priority,
                        "scheduled_time": r.Appointment.scheduled_time,
                        "service": r.Appointment.service,
                        "appointment_type": r.Appointment.appointment_type,
                        "payment_status": r.Appointment.payment_status
                    },
                    "patient": {
                        "id": r.Patient.id,
                        "first_name": r.Patient.first_name,
                        "last_name": r.Patient.last_name,
                        "nss": r.Patient.nss
                    }
                } for r in records
            ]

            background_tasks.add_task(manager.broadcast, {
                "type": "appointment_update",
                "doctor_id": payload.doctor_id,
                "appointments": appointments_payload
            })
        except Exception as e:
            print(f"Broadcast error (appointment_update after create): {e}")
    
    return {"msg": "Appointment created", "ticket": generated_ticket}

@app.get("/appointments/all")
def get_all_appointments(db: Session = Depends(get_db)):
    # ✅ Join with User table to get doctor info for Cashier billing
    records = db.query(
        models.Appointment.id,
        models.Appointment.status,
        models.Appointment.priority,
        models.Appointment.scheduled_time,
        models.Appointment.doctor_id,
        models.Appointment.patient_id,
        models.Appointment.service,
        models.Appointment.ticket_number,
        models.Appointment.payment_status,
        models.Patient.first_name,
        models.Patient.last_name,
        models.Patient.nss,
        models.User.full_name.label("doctor_full_name"),
        models.User.username.label("doctor_username")
    ).join(models.Patient, models.Appointment.patient_id == models.Patient.id)\
     .join(models.User, models.Appointment.doctor_id == models.User.id).all()
    
    return [
        {
            "id": row.id,
            "status": row.status,
            "priority": row.priority,
            "scheduled_time": row.scheduled_time,
            "doctor_id": row.doctor_id,
            "patient_id": row.patient_id,
            "service": row.service,
            "ticket_number": row.ticket_number,
            "payment_status": row.payment_status,
            "first_name": row.first_name,
            "last_name": row.last_name,
            "nss": row.nss,
            "doctor_full_name": row.doctor_full_name,
            "doctor_username": row.doctor_username
        } for row in records
    ]

@app.patch("/appointments/{appt_id}/status")
def update_status(appt_id: int, payload: schemas.StatusUpdate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    
    old_status = appt.status
    
    # 1. Update the Medical Status (Waiting -> In Progress)
    if payload.status:
        appt.status = payload.status
        # Log the status change
        log_action(db, "Doctor", "APPOINTMENT_STATUS_CHANGED", f"Ticket {appt.ticket_number}: {old_status} → {payload.status}")
        
    # 2. 💰 THE MISSING LINK: Update the Financial Status (Unpaid -> Paid)
    if payload.payment_status:
        appt.payment_status = payload.payment_status
        # Log the payment for security!
        log_action(db, "Cashier", "PAYMENT_RECEIVED", f"Ticket {appt.ticket_number} marked as {payload.payment_status}")
        
    db.commit()
    db.refresh(appt)
    
    # 🔌 BROADCAST: Appointment status changed
    background_tasks.add_task(manager.broadcast, {
        "type": "appointment_status_changed",
        "appointment_id": appt.id,
        "doctor_id": appt.doctor_id,
        "ticket_number": appt.ticket_number,
        "old_status": old_status,
        "new_status": appt.status,
        "payment_status": appt.payment_status
    })
    # Also send canonical appointment_update for the affected doctor to keep clients in sync
    if appt.doctor_id is not None:
        try:
            records = db.query(models.Appointment, models.Patient).join(
                models.Patient, models.Appointment.patient_id == models.Patient.id
            ).filter(
                models.Appointment.doctor_id == appt.doctor_id,
                models.Appointment.status.in_(["Waiting", "In Progress"])
            ).all()

            appointments_payload = [
                {
                    "appointment": {
                        "id": r.Appointment.id,
                        "ticket_number": r.Appointment.ticket_number,
                        "status": r.Appointment.status,
                        "priority": r.Appointment.priority,
                        "scheduled_time": r.Appointment.scheduled_time,
                        "service": r.Appointment.service,
                        "appointment_type": r.Appointment.appointment_type,
                        "payment_status": r.Appointment.payment_status
                    },
                    "patient": {
                        "id": r.Patient.id,
                        "first_name": r.Patient.first_name,
                        "last_name": r.Patient.last_name,
                        "nss": r.Patient.nss
                    }
                } for r in records
            ]

            background_tasks.add_task(manager.broadcast, {
                "type": "appointment_update",
                "doctor_id": appt.doctor_id,
                "appointments": appointments_payload
            })
        except Exception as e:
            print(f"Broadcast error (appointment_update after status): {e}")
    
    return appt

@app.patch("/appointments/{appointment_id}/consultation")
def save_consultation(appointment_id: int, payload: schemas.ConsultationUpdate, db: Session = Depends(get_db)):
    appt = db.query(models.Appointment).filter(models.Appointment.id == appointment_id).first()
    if not appt:
        raise HTTPException(status_code=404, detail="Appointment not found")
    
    appt.diagnosis = payload.diagnosis
    appt.treatment = payload.treatment
    appt.status = "Completed"
    
    # 🔗 BLOCKCHAIN PREP: Generate the SHA-256 Hash
    # We combine the patient ID, diagnosis, and treatment to create a unique fingerprint
    raw_data = f"{appt.patient_id}|{payload.diagnosis}|{payload.treatment}"
    digital_fingerprint = hashlib.sha256(raw_data.encode('utf-8')).hexdigest()
    print(f"🔒 BLOCKCHAIN HASH GENERATED: {digital_fingerprint}")
    
    # 🔗 SEND TO GANACHE
    if medical_contract:
        try:
            nonce = w3.eth.get_transaction_count(WALLET_ADDRESS)
            tx = medical_contract.functions.secureRecord(
                appointment_id,
                digital_fingerprint
            ).build_transaction({
                'gas': 2000000,
                'gasPrice': w3.eth.gas_price,
                'nonce': nonce,
            })

            signed_tx = w3.eth.account.sign_transaction(tx, private_key=PRIVATE_KEY)
            tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
            
            print(f"✅ BLOCKCHAIN SUCCESS! Hash sent to Ganache: {w3.to_hex(tx_hash)}")
        except Exception as e:
            print(f"❌ BLOCKCHAIN ERROR: {e}")
    else:
        print("⚠️ Blockchain skipped: Contract details missing at the top of main.py")
    
    db.commit()
    # Log the action with a preview of the hash for the audit trail
    log_action(db, payload.user, "CONSULTATION_SAVED", f"Medical record signed. Hash: {digital_fingerprint[:10]}...")
    
    return {"msg": "Medical record saved securely", "hash": digital_fingerprint}


# --- 💉 NURSING TASKS ---
@app.post("/nursing-tasks")
def create_nursing_task(payload: schemas.NursingTaskCreate, db: Session = Depends(get_db)):
    new_task = models.NursingTask(
        patient_name=payload.patient_name,
        task_description=payload.task_description,
        room_number=payload.room_number,
        status=payload.status,
        created_at=datetime.utcnow()
    )
    db.add(new_task)
    db.commit()
    return {"msg": "Task delegated"}

@app.get("/nursing-tasks")
def get_nursing_tasks(db: Session = Depends(get_db)):
    return db.query(models.NursingTask).all()

@app.patch("/nursing-tasks/{task_id}/status")
def update_task_status(task_id: int, payload: schemas.NursingTaskUpdate, db: Session = Depends(get_db)):
    task = db.query(models.NursingTask).filter(models.NursingTask.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.status = payload.status
    task.completed_by = payload.completed_by
    db.commit()
    
    if task.status == "Completed":
        log_action(db, payload.completed_by or "Infirmier", "TASK_COMPLETED", f"Completed medical task for {task.patient_name}")
        
    return {"msg": "Task updated successfully"}


# --- 📦 INVENTORY & AUDIT LOGS ---
@app.get("/audit-logs")
def get_logs(db: Session = Depends(get_db)):
    return db.query(models.AuditLog).order_by(models.AuditLog.timestamp.desc()).all()

from pydantic import BaseModel
class AuditLogCreate(BaseModel):
    user: str
    action: str
    details: str

@app.post("/audit-logs")
def create_log_entry(payload: AuditLogCreate, db: Session = Depends(get_db)):
    log_action(db, payload.user, payload.action, payload.details)
    return {"msg": "Log created successfully"}

@app.get("/inventory/")
def get_inventory(db: Session = Depends(get_db)):
    return db.query(models.InventoryItem).all()


# --- ⚙️ SYSTEM SETTINGS ---
@app.get("/settings")
def get_settings(db: Session = Depends(get_db)):
    settings = db.query(models.SystemSettings).first()
    if not settings:
        settings = models.SystemSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings

@app.patch("/settings")
def update_settings(payload: schemas.SettingsUpdate, db: Session = Depends(get_db)):
    settings = db.query(models.SystemSettings).first()
    if not settings:
        settings = models.SystemSettings()
        db.add(settings)
        
    if payload.hospital_name is not None: settings.hospital_name = payload.hospital_name
    if payload.tv_announcement is not None: settings.tv_announcement = payload.tv_announcement
    if payload.services is not None: settings.services = payload.services 
    if hasattr(payload, 'rooms') and payload.rooms is not None: settings.rooms = payload.rooms
    if hasattr(payload, 'prices') and payload.prices is not None: settings.prices = payload.prices
        
    db.commit()
    return settings

@app.patch("/settings/rooms")
def update_hospital_rooms(payload: schemas.RoomsUpdate, db: Session = Depends(get_db)):
    settings = db.query(models.SystemSettings).first()
    if not settings:
        settings = models.SystemSettings()
        db.add(settings)
    
    settings.rooms = payload.rooms
    db.commit()
    return {"msg": "Mise à jour des lits réussie !"}


# --- STARTUP AUTO-ADMIN ---
@app.on_event("startup")
def startup_event():
    db = next(get_db())
    try:
        if not db.query(models.User).filter(models.User.username == "admin").first():
            # ✅ Try to hash password, fallback to plaintext if hashing fails (bcrypt compatibility)
            try:
                hashed_pwd = get_password_hash("admin123")
            except Exception as hash_error:
                print(f"⚠️  Password hashing failed: {hash_error}. Using plaintext password for development.")
                hashed_pwd = "admin123"
            
            new_admin = models.User(username="admin", password=hashed_pwd, role="admin")
            db.add(new_admin)
            db.commit()
            log_action(db, "System", "STARTUP", "Default admin account created")
    except Exception as e:
        print(f"⚠️  Startup event error: {e}")
        db.rollback()

# --- 🛏️ HOSPITALISATION BEDS (UPGRADED) ---
@app.get("/hospitalizations/active")
def get_active_hospitalizations(db: Session = Depends(get_db)):
    return db.query(models.Hospitalization).filter(models.Hospitalization.status == "Occupied").all()

@app.get("/hospitalizations/history")
def get_hospitalizations_history(patient_id: int, db: Session = Depends(get_db)):
    records = db.query(models.Hospitalization).filter(models.Hospitalization.patient_id == patient_id).order_by(models.Hospitalization.id.desc()).all()
    return records

@app.get("/doctor/{doctor_id}/ward")
def get_doctor_ward(doctor_id: int, db: Session = Depends(get_db)):
    # Gets only the patients admitted by THIS specific doctor
    return db.query(models.Hospitalization).filter(
        models.Hospitalization.doctor_id == doctor_id,
        models.Hospitalization.status == "Occupied"
    ).all()

@app.post("/hospitalizations/")
def admit_patient(payload: schemas.HospitalizationCreate, background_tasks: BackgroundTasks, request: Request, db: Session = Depends(get_db)):
    # 1. Collision Checks
    if db.query(models.Hospitalization).filter(models.Hospitalization.patient_id == payload.patient_id, models.Hospitalization.status == "Occupied").first():
        raise HTTPException(status_code=400, detail="Patient already admitted.")
        
    if db.query(models.Hospitalization).filter(models.Hospitalization.room_name == payload.room_name, models.Hospitalization.bed_number == payload.bed_number, models.Hospitalization.status == "Occupied").first():
        raise HTTPException(status_code=400, detail="This exact bed is currently occupied.")

    # 2. ✅ Extract doctor info directly and store in model columns
    new_hosp = models.Hospitalization(
        patient_id=payload.patient_id,
        patient_name=payload.patient_name,
        department=payload.department,
        room_name=payload.room_name,
        bed_number=payload.bed_number,
        admission_date=payload.admission_date,
        status="Occupied",
        doctor_id=payload.doctor_id,
        doctor_name=payload.doctor_name,
    )

    db.add(new_hosp)
    db.commit()
    db.refresh(new_hosp)
    log_action(db, payload.dict().get("doctor_name", "Unknown"), "PATIENT_ADMITTED", f"Admitted {payload.patient_name} to {payload.room_name} bed {payload.bed_number}")
    
    # 🔌 BROADCAST: Patient admitted to bed
    background_tasks.add_task(manager.broadcast, {
        "type": "patient_admitted",
        "hospitalization_id": new_hosp.id,
        "patient_name": payload.patient_name,
        "room_name": payload.room_name,
        "bed_number": payload.bed_number,
        "department": payload.department
    })
    
    return {"msg": "Patient admitted successfully"}

@app.patch("/hospitalizations/{hosp_id}/discharge")
def discharge_patient(hosp_id: int, background_tasks: BackgroundTasks, payload: dict = Body(...), db: Session = Depends(get_db)):
    hosp = db.query(models.Hospitalization).filter(models.Hospitalization.id == hosp_id).first()
    if not hosp:
        raise HTTPException(status_code=404, detail="Hospitalization record not found")
    
    doctor_name = payload.get("doctor_name", "Doctor")
    
    hosp.status = "Discharged"
    hosp.discharge_date = datetime.utcnow().isoformat()
    db.commit()
    log_action(db, doctor_name, "PATIENT_DISCHARGED", f"Discharged {hosp.patient_name} from {hosp.room_name}")
    
    # 🔌 BROADCAST: Patient discharged (bed now free)
    background_tasks.add_task(manager.broadcast, {
        "type": "patient_discharged",
        "hospitalization_id": hosp.id,
        "room_name": hosp.room_name,
        "bed_number": hosp.bed_number
    })
    
    return {"msg": "Patient discharged"}


LAB_CATALOGUE = {
    "Hématologie": [
        "NFS (Numération Formule Sanguine)",
        "Groupe Sanguin + Rhésus",
        "VS (Vitesse de Sédimentation)",
        "TP / TCA (Hémostase)",
        "Frottis Sanguin",
    ],
    "Biochimie": [
        "Glycémie à jeun",
        "Glycémie post-prandiale",
        "HbA1c",
        "Créatinine + Urée",
        "Bilan hépatique (ASAT/ALAT/GGT/PAL)",
        "Bilan lipidique (Cholestérol/TG/HDL/LDL)",
        "Ionogramme sanguin (Na/K/Cl)",
        "Protéines totales / Albumine",
        "Acide urique",
        "Troponine I (urgence cardiaque)",
    ],
    "Microbiologie": [
        "ECBU (Examen Cytobactériologique des Urines)",
        "Coproculture",
        "Hémoculture",
        "Antibiogramme",
        "BK (Bacilloscopie)",
    ],
    "Sérologie / Immunologie": [
        "CRP (Protéine C-Réactive)",
        "Sérologie HIV",
        "Sérologie Hépatite B (AgHBs)",
        "Sérologie Hépatite C",
        "TPHA / VDRL (Syphilis)",
        "Test de grossesse (βhCG)",
        "TSH / T3 / T4 (Thyroïde)",
        "PSA (Prostate)",
        "Ferritine / Fer sérique",
        "Vitamine D",
        "Vitamine B12",
    ],
    "Parasitologie": [
        "Examen Parasitologique des Selles",
        "Sérologie Toxoplasmose",
        "Sérologie Paludisme",
    ],
}
 
 
@app.get("/lab/catalogue")
def get_lab_catalogue():
    """Return the full test catalogue. Used by doctor order form dropdowns."""
    return LAB_CATALOGUE
 
 
# ── Order a lab test (called by doctor during consultation) ───────────────────
@app.post("/lab/orders")
def create_lab_order(
    payload: schemas.LabOrderCreate,
    db: Session = Depends(get_db),
):
    new_order = models.LabOrder(
        patient_id     = payload.patient_id,
        doctor_id      = payload.doctor_id,
        doctor_name    = payload.doctor_name,
        test_name      = payload.test_name,
        test_category  = payload.test_category,
        clinical_notes = payload.clinical_notes,
        urgency        = payload.urgency or "Normal",
        status         = "Ordered",
        ordered_at     = datetime.utcnow(),
        appointment_id = payload.appointment_id,
    )
    db.add(new_order)
    db.commit()
    db.refresh(new_order)
 
    log_action(
        db,
        payload.user or payload.doctor_name or "Doctor",
        "LAB_ORDER_CREATED",
        f"Ordered '{payload.test_name}' for Patient #{payload.patient_id} — Urgency: {new_order.urgency}"
    )
 
    # Broadcast so the lab dashboard refreshes immediately
    # (fire-and-forget; no await needed here since the route is sync)
    import asyncio
    asyncio.create_task(manager.broadcast({
        "type":     "lab_order_created",
        "order_id": new_order.id,
        "urgency":  new_order.urgency,
        "test":     new_order.test_name,
    })) if False else None   # replace with background_tasks if you add that param
 
    return {"msg": "Lab order created", "order_id": new_order.id}
 
 
@app.get("/lab/orders/today")
def get_today_lab_orders(db: Session = Depends(get_db)):
    """ Returns all lab orders for today (or all unpaid if easier), used by Cashier to bill them. """
    # To be safe and just get everything recent for the cashier:
    # Actually, we can just return all recent orders (e.g. last 100)
    orders = (
        db.query(models.LabOrder, models.Patient)
        .join(models.Patient, models.LabOrder.patient_id == models.Patient.id)
        .order_by(models.LabOrder.ordered_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id"            : row.LabOrder.id,
            "test_name"     : row.LabOrder.test_name,
            "test_category" : row.LabOrder.test_category,
            "status"        : row.LabOrder.status,
            "ordered_at"    : row.LabOrder.ordered_at,
            "doctor_name"   : row.LabOrder.doctor_name,
            "patient_name"  : f"{row.Patient.first_name} {row.Patient.last_name}",
            "patient_nss"   : row.Patient.nss,
        }
        for row in orders
    ]


# ── Get all pending orders (for the lab technician dashboard) ─────────────────
@app.get("/lab/orders/pending")
def get_pending_lab_orders(db: Session = Depends(get_db)):
    """
    Returns all Ordered/In-Progress orders joined with patient name.
    Used by the Lab Technician workspace.
    """
    orders = (
        db.query(models.LabOrder, models.Patient)
        .join(models.Patient, models.LabOrder.patient_id == models.Patient.id)
        .filter(models.LabOrder.status.in_(["Ordered", "In Progress"]))
        .order_by(
            # STAT first, then Urgent, then Normal
            models.LabOrder.urgency.desc(),
            models.LabOrder.ordered_at.asc()
        )
        .all()
    )
 
    return [
        {
            "id"            : row.LabOrder.id,
            "test_name"     : row.LabOrder.test_name,
            "test_category" : row.LabOrder.test_category,
            "clinical_notes": row.LabOrder.clinical_notes,
            "urgency"       : row.LabOrder.urgency,
            "status"        : row.LabOrder.status,
            "ordered_at"    : row.LabOrder.ordered_at,
            "doctor_name"   : row.LabOrder.doctor_name,
            "appointment_id": row.LabOrder.appointment_id,
            "patient_id"    : row.Patient.id,
            "patient_name"  : f"{row.Patient.first_name} {row.Patient.last_name}",
            "patient_nss"   : row.Patient.nss,
        }
        for row in orders
    ]
 
 
# ── Mark an order as "In Progress" (lab tech starts processing) ───────────────
@app.patch("/lab/orders/{order_id}/start")
def start_lab_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    order.status = "In Progress"
    db.commit()
    return {"msg": "Order started"}
 
 
# ── Submit results (lab tech fills in measured values) ────────────────────────
@app.post("/lab/orders/{order_id}/results")
def submit_lab_results(
    order_id : int,
    payload  : schemas.LabResultsSubmit,
    db       : Session = Depends(get_db),
):
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
 
    # Delete any previously entered results for this order (allow re-submission)
    db.query(models.LabResult).filter(models.LabResult.order_id == order_id).delete()
 
    for r in payload.results:
        db.add(models.LabResult(
            order_id  = order_id,
            parameter = r.parameter,
            value     = r.value,
            unit      = r.unit,
            ref_min   = r.ref_min,
            ref_max   = r.ref_max,
            flag      = r.flag,
        ))
 
    order.status        = "Completed"
    order.completed_at  = datetime.utcnow()
    order.lab_tech_name = payload.lab_tech_name
 
    db.commit()
 
    log_action(
        db,
        payload.lab_tech_name or "Lab Tech",
        "LAB_RESULTS_SUBMITTED",
        f"Results entered for order #{order_id} ({order.test_name}) — Patient #{order.patient_id}"
    )
 
    return {"msg": "Results submitted successfully"}
 
 
# ── Validate a completed order (doctor signs off) ────────────────────────────
@app.patch("/lab/orders/{order_id}/validate")
def validate_lab_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
    order.status = "Validated"
    db.commit()
    log_action(db, "Doctor", "LAB_RESULTS_VALIDATED", f"Validated lab order #{order_id}")
    return {"msg": "Order validated"}
 
 
# ── Get all lab orders for a specific patient (for the medical folder) ────────
@app.get("/lab/patient/{patient_id}")
def get_patient_lab_history(patient_id: int, db: Session = Depends(get_db)):
    """
    Returns every lab order + its results for a patient.
    Used by the upgraded patient medical folder.
    """
    orders = (
        db.query(models.LabOrder)
        .filter(models.LabOrder.patient_id == patient_id)
        .order_by(models.LabOrder.ordered_at.desc())
        .all()
    )
 
    output = []
    for order in orders:
        results = (
            db.query(models.LabResult)
            .filter(models.LabResult.order_id == order.id)
            .all()
        )
        output.append({
            "id"            : order.id,
            "test_name"     : order.test_name,
            "test_category" : order.test_category,
            "clinical_notes": order.clinical_notes,
            "urgency"       : order.urgency,
            "status"        : order.status,
            "ordered_at"    : order.ordered_at,
            "completed_at"  : order.completed_at,
            "doctor_name"   : order.doctor_name,
            "lab_tech_name" : order.lab_tech_name,
            "results"       : [
                {
                    "parameter": r.parameter,
                    "value"    : r.value,
                    "unit"     : r.unit,
                    "ref_min"  : r.ref_min,
                    "ref_max"  : r.ref_max,
                    "flag"     : r.flag,
                }
                for r in results
            ],
        })
 
    return output
 
 
# ── Get a single order with its results (for printing / detail view) ──────────
@app.get("/lab/orders/{order_id}")
def get_lab_order_detail(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.LabOrder).filter(models.LabOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Lab order not found")
 
    patient = db.query(models.Patient).filter(models.Patient.id == order.patient_id).first()
    results = db.query(models.LabResult).filter(models.LabResult.order_id == order_id).all()
 
    return {
        "order"  : order,
        "patient": patient,
        "results": results,
    }
 

@app.patch("/lab/orders/{order_id}/payment")
def pay_lab_order(order_id: int, db=Depends(get_db)):
    order = db.query(models.LabOrder).filter_by(id=order_id).first()
    order.payment_status = "Paid"
    db.commit()
    log_action(db, "Cashier", "LAB_PAYMENT_RECEIVED", f"Lab order #{order_id} paid")
    return {"msg": "Payment recorded"}  