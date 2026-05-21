#!/usr/bin/env python3
import urllib.request, urllib.error, json, sys
from datetime import datetime

BASE_CANDIDATES = ["http://localhost:8000", "http://127.0.0.1:8000"]

def http_get(url):
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.getcode(), resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8') if hasattr(e, 'read') else ''
        return e.code, body
    except Exception as e:
        print(f"ERROR: Connection to {url} failed: {e}")
        return None, None


def http_post(url, data):
    data_bytes = json.dumps(data).encode('utf-8')
    req = urllib.request.Request(url, data=data_bytes, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.getcode(), resp.read().decode('utf-8')
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8') if hasattr(e, 'read') else ''
        return e.code, body
    except Exception as e:
        print(f"ERROR: POST to {url} failed: {e}")
        return None, None


# 0) find a reachable base URL
base = None
last_err = None
for candidate in BASE_CANDIDATES:
    code, body = http_get(candidate + "/health")
    if code == 200:
        base = candidate
        break
    last_err = (candidate, code, body)

if not base:
    print("ERROR: Backend not reachable at http://localhost:8000 or http://127.0.0.1:8000. Last attempt:")
    print(last_err)
    sys.exit(1)

# 1) GET /users/min
print("STEP 1: GET /users/min")
code, body = http_get(base + "/users/min")
if code != 200:
    print(f"ERROR: GET /users/min returned status {code}")
    if body:
        print(body)
    sys.exit(1)

try:
    users = json.loads(body)
except Exception as e:
    print("ERROR: Failed to parse JSON from /users/min:", e)
    sys.exit(1)

first_doctor_id = None
for u in users:
    role = (u.get('role') or '').lower()
    if role == 'doctor':
        first_doctor_id = u.get('id')
        break

if not first_doctor_id:
    print("ERROR: No doctor user found in /users/min")
    sys.exit(1)

print(f"FOUND_DOCTOR_ID: {first_doctor_id}")

# 2) POST a consultation appointment for patient_id=1 to that doctor
print("STEP 2: POST /appointments/ (consultation to doctor)")
appt_payload = {
    "patient_id": 1,
    "doctor_id": first_doctor_id,
    "scheduled_time": datetime.utcnow().isoformat(),
    "priority": "Normal",
    "service": "Consultation",
    "appointment_type": "Scheduled",
    "user": "smoke-test"
}
code, body = http_post(base + "/appointments/", appt_payload)
if code != 200:
    print(f"ERROR: POST /appointments/ returned status {code}")
    if body:
        print(body)
    sys.exit(1)
print("APPOINTMENT_CREATED:")
print(body)

# 3) POST a nurse appointment for patient_id=1 with doctor_id=null
print("STEP 3: POST /appointments/ (nurse appointment with doctor_id=null)")
# Intentionally set doctor_id to None -> JSON null
nurse_payload = {
    "patient_id": 1,
    "doctor_id": None,
    "scheduled_time": datetime.utcnow().isoformat(),
    "priority": "Normal",
    "service": "Nursing",
    "appointment_type": "Walk-In",
    "user": "smoke-test"
}
code, body = http_post(base + "/appointments/", nurse_payload)
if code is None:
    print("ERROR: Request failed (network error)")
    sys.exit(1)
if code != 200:
    print(f"NON-200 RESPONSE for nurse appointment: {code}")
    if body:
        print(body)
    sys.exit(1)
print("NURSE_APPOINTMENT_CREATED:")
print(body)

# 4) GET /doctor/queue/{doctor_id}
print("STEP 4: GET /doctor/queue/{doctor_id}")
code, body = http_get(f"{base}/doctor/queue/{first_doctor_id}")
if code != 200:
    print(f"ERROR: GET doctor queue returned status {code}")
    if body:
        print(body)
    sys.exit(1)
print("DOCTOR_QUEUE_JSON:")
print(body)

print("SMOKE TEST COMPLETED")
