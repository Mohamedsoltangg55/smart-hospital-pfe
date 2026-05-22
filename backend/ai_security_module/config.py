"""Centralized paths and hyperparameters for the AI security pipeline."""
import os

# Module root
MODULE_DIR = os.path.dirname(os.path.abspath(__file__))

# Artifact locations (created at training time)
ARTIFACTS_DIR = os.path.join(MODULE_DIR, "artifacts")
DATA_DIR = os.path.join(ARTIFACTS_DIR, "data")
RAW_DATA_PATH = os.path.join(DATA_DIR, "healthcare_audit_logs.csv")
PROCESSED_DATA_PATH = os.path.join(DATA_DIR, "processed.npz")

MODEL_PATH = os.path.join(ARTIFACTS_DIR, "autoencoder.pth")
PREPROCESSOR_PATH = os.path.join(ARTIFACTS_DIR, "preprocessor.joblib")
THRESHOLD_PATH = os.path.join(ARTIFACTS_DIR, "threshold.json")

# Dataset generation
N_SYNTHETIC_NORMAL = 12000
N_SYNTHETIC_ANOMALY = 600
DEFAULT_SEED = 42

# Feature engineering
ROLLING_WINDOW_MINUTES = 60      # action frequency window per user
RAPID_BURST_WINDOW_MINUTES = 5   # short window for exfiltration detection

# Model
BOTTLENECK_DIM = 8
HIDDEN_DIMS = [32, 16]
DROPOUT = 0.1

# Training
BATCH_SIZE = 256
EPOCHS = 60
LEARNING_RATE = 1e-3
EARLY_STOP_PATIENCE = 8
VAL_SPLIT = 0.15

# Threshold: percentile of reconstruction error on clean validation set.
# Lowered from 99 -> 95: P99 only caught ~53% of anomalies. P95 trades a
# slightly higher false-positive rate (~5% of normal logs) for better recall.
THRESHOLD_PERCENTILE = 95.0


def ensure_dirs():
    os.makedirs(ARTIFACTS_DIR, exist_ok=True)
    os.makedirs(DATA_DIR, exist_ok=True)
