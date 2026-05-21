from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
import joblib
import numpy as np
import os

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load the Trained Model
# (If file exists, load it. If not, wait for training)
MODEL_PATH = "heart_disease_model.pkl"
model = None

if os.path.exists(MODEL_PATH):
    model = joblib.load(MODEL_PATH)

class PatientData(BaseModel):
    age: int
    medical_history: str

@app.post("/predict_heart_risk")
def predict_risk(data: PatientData):
    # 1. Parse Text to Numbers (Simple NLP)
    history = data.medical_history.lower()
    has_diabetes = 1 if "diabetes" in history else 0
    has_bp = 1 if "blood pressure" in history or "hypertension" in history else 0
    is_smoker = 1 if "smoker" in history else 0
    
    # 2. Prepare Features for the Model
    features = np.array([[data.age, has_diabetes, has_bp, is_smoker]])
    
    # 3. Predict using the "Brain" (if loaded)
    if model:
        risk_level = model.predict(features)[0]  # Returns 0, 1, 2, or 3
        # Calculate a probability score (0-100%)
        probability = model.predict_proba(features)[0][risk_level] * 100
    else:
        # Fallback if model isn't trained yet
        risk_level = 1
        probability = 50

    # 4. Map Number to Text
    labels = {0: "LOW RISK", 1: "MODERATE RISK", 2: "HIGH RISK", 3: "CRITICAL RISK"}
    status = labels.get(risk_level, "UNKNOWN")

    return {
        "risk_score": int(probability),
        "status": status,
        "analysis": [
            f"Model Prediction: Class {risk_level}",
            f"Diabetes Detected: {'Yes' if has_diabetes else 'No'}",
            f"Hypertension: {'Yes' if has_bp else 'No'}"
        ]
    }