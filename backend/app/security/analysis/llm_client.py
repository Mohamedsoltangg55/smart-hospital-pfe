"""
llm_client.py -- provider-agnostic LLM adapter.

Currently wraps Groq (OpenAI-compatible chat completions). Swapping to another
provider is a one-file change here. The `groq` SDK is imported LAZILY so this
module loads even when the package is absent (e.g. MOCK_LLM mode before an
image rebuild).
"""
from __future__ import annotations

from . import config


class LLMUnavailable(Exception):
    """Raised when the LLM cannot be reached or used (no key, missing SDK,
    timeout, rate-limit, network/auth error)."""


def complete_json(system_prompt: str, user_prompt: str) -> str:
    """Call the LLM in JSON mode and return the raw response text.

    Raises LLMUnavailable on any provider/transport failure -- the caller
    (service.py) turns that into the typed fallback."""
    if not config.GROQ_API_KEY:
        raise LLMUnavailable("GROQ_API_KEY is not set")

    try:
        from groq import Groq
    except Exception as e:  # SDK not installed
        raise LLMUnavailable(f"groq SDK not installed: {e}")

    try:
        client = Groq(api_key=config.GROQ_API_KEY, timeout=config.LLM_TIMEOUT_SECONDS)
        completion = client.chat.completions.create(
            model=config.LLM_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            temperature=config.LLM_TEMPERATURE,
            max_tokens=config.LLM_MAX_TOKENS,
        )
        content = completion.choices[0].message.content
        if not content or not content.strip():
            raise LLMUnavailable("empty response from provider")
        return content
    except LLMUnavailable:
        raise
    except Exception as e:
        # Network error, 429 rate-limit, timeout, auth error -> all "unavailable".
        raise LLMUnavailable(f"{type(e).__name__}: {e}")


def active_model() -> str:
    return config.LLM_MODEL
