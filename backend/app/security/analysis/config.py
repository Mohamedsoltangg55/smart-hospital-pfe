"""
config.py -- LLM analysis-layer configuration.

Provider-agnostic on purpose: swapping Groq for another OpenAI-compatible
provider should be a one-file change (llm_client.py) plus these env vars.
"""
import os


def _flag(name: str, default: str = "false") -> bool:
    return os.getenv(name, default).strip().lower() in ("1", "true", "yes", "on")


# --- Provider ---
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "groq")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")

# Groq rotates model names -- this is env-overridable. Confirmed current via
# Groq docs: "llama-3.3-70b-versatile" (production model, 128K ctx, JSON mode).
LLM_MODEL = os.getenv("LLM_MODEL", "llama-3.3-70b-versatile")

# --- Reliability ---
LLM_TIMEOUT_SECONDS = float(os.getenv("LLM_TIMEOUT_SECONDS", "30"))
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.2"))
LLM_MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1400"))
# Retries on invalid/partial JSON before falling back (1 retry => 2 attempts).
LLM_JSON_RETRIES = int(os.getenv("LLM_JSON_RETRIES", "1"))

# --- Demo / offline safety ---
# When true: return a realistic canned analysis with NO network call. Works
# with no API key and no internet -- the offline / demo-day fallback.
MOCK_LLM = _flag("MOCK_LLM", "false")

# --- Privacy ---
# Redact obvious direct identifiers (e.g. NSS numbers) before sending to the LLM.
REDACT_PII = _flag("REDACT_PII", "true")

# --- Rate limiting (analyze endpoint) ---
# Per-user cap on AI analysis requests, sized to protect the Groq free-tier
# quota. A user may run at most ANALYZE_RATE_MAX analyses within any rolling
# ANALYZE_RATE_WINDOW_SECONDS window; further requests get a clean 429.
ANALYZE_RATE_MAX = int(os.getenv("ANALYZE_RATE_MAX", "10"))
ANALYZE_RATE_WINDOW_SECONDS = int(os.getenv("ANALYZE_RATE_WINDOW_SECONDS", "60"))
