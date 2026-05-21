# Changelog — Smart Hospital PFE

## 2026-05-20

- Backend: Broadcast canonical `appointment_update` payloads after appointment creation and status changes. Payloads now include full `appointment` and `patient` objects to ensure frontend consistency.
- Frontend: `DoctorQueues.jsx`
  - Added defensive WebSocket handling: validate incoming `appointment_update` payload shape and fall back to canonical HTTP fetch if payload looks trimmed.
  - Added optional chaining/fallbacks in table renderers and active patient card to avoid runtime errors when WS payloads are incomplete.
- Frontend: `FrontDeskTriage.jsx`
  - Fixed nurse ticket creation: removed `staff[0]?.id || 1` fallback. Nurse tickets now use `doctor_id: null` so they don't appear in doctor queues.
- Tests: Added `backend/smoke_test.py` script to automate a quick verification flow (fetch doctors, create consult + nurse tickets, fetch queue).

### Notes & Next Steps
- Manual verification pending: run smoke test and observe WS messages / doctor queue updates.
- If the backend fails to start due to environment mismatch, create a fresh virtual environment and install dependencies from `backend/requirements.txt`.
- Consider adding integration tests for WebSocket and queue synchronization.
