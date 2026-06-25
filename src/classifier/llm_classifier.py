"""
DeepSeek-powered email classifier.

Uses LangChain's ChatOpenAI (with DeepSeek's OpenAI-compatible API) to
classify emails into one of seven categories.  Falls back to "fyi" on
parse errors or unexpected categories.

Ported from src/code/classifier.ts.
"""

import json
import logging
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from src.config import settings

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

VALID_CATEGORIES: tuple[str, ...] = (
    "newsletter",
    "action",
    "social",
    "promotions",
    "career",
    "fyi",
    "spam",
)

CLASSIFICATION_SYSTEM_PROMPT = """You are an email classifier. Return valid JSON only — no markdown, no explanation, no extra text.

Classify the email into exactly one category:

- "newsletter":   Blog digests, editorial content, curated reading lists, publication emails
- "action":       Requires a direct reply or response (questions, requests, meeting invites, tasks)
- "social":       Notifications from social platforms (LinkedIn, Twitter/X, Facebook, Instagram, Reddit, GitHub, Discord)
- "promotions":   Sales, discount codes, limited-time offers, marketing campaigns, product launches
- "career":       Job postings, recruiter outreach, interview requests, application updates, job alerts
- "fyi":          Receipts, order confirmations, shipping updates, account notifications, no reply needed
- "spam":         Junk mail, phishing, irrelevant unsolicited bulk mail

Return exactly this JSON:
{
  "category": "newsletter|action|social|promotions|career|fyi|spam"
}"""

# ─────────────────────────────────────────────
# Internally cached LLM instance
# ─────────────────────────────────────────────

_llm: ChatOpenAI | None = None


def _get_llm() -> ChatOpenAI:
    """Lazy-initialise the DeepSeek LLM client."""
    global _llm
    if _llm is None:
        _llm = ChatOpenAI(
            model=settings.deepseek_model,
            base_url=settings.deepseek_base_url,
            api_key=settings.deepseek_api_key,
            temperature=settings.deepseek_temperature,
            max_tokens=settings.deepseek_max_tokens,
        )
        logger.info("Initialised LLM: model=%s base_url=%s", settings.deepseek_model, settings.deepseek_base_url)
    return _llm


# ─────────────────────────────────────────────
# Public helpers
# ─────────────────────────────────────────────


def build_classification_prompt(from_addr: str, subject: str, body_preview: str) -> str:
    """Build the user-facing prompt from email fields.

    Args:
        from_addr: The ``From:`` header value.
        subject: The ``Subject:`` header value.
        body_preview: First ~300 characters of the plain-text body.

    Returns:
        A plain-text prompt string.
    """
    return f"From: {from_addr}\nSubject: {subject}\nBody preview: {body_preview}"


def normalize_category(raw: str) -> str:
    """Clean and validate a category string, falling back to ``"fyi"``.

    Args:
        raw: Raw category string from the LLM response.

    Returns:
        A valid category key, or ``"fyi"`` if the raw value isn't recognised.
    """
    cleaned = raw.strip().lower()
    if cleaned in VALID_CATEGORIES:
        return cleaned
    logger.warning("Unexpected category %r — falling back to 'fyi'", raw)
    return "fyi"


def force_clear_llm() -> None:
    """Reset the cached LLM client (useful for testing)."""
    global _llm
    _llm = None


# ─────────────────────────────────────────────
# Main classification entry-point
# ─────────────────────────────────────────────


def classify(from_addr: str, subject: str, body_preview: str) -> str:
    """Run DeepSeek classification on email fields.

    Args:
        from_addr: The ``From:`` header value.
        subject: The ``Subject:`` header value.
        body_preview: First ~300 characters of the plain-text body.

    Returns:
        Normalised category string (one of ``VALID_CATEGORIES``).
    """
    llm = _get_llm()

    messages = [
        SystemMessage(content=CLASSIFICATION_SYSTEM_PROMPT),
        HumanMessage(content=build_classification_prompt(from_addr, subject, body_preview)),
    ]

    try:
        response = llm.invoke(messages)
        content = response.content.strip() if response.content else ""
    except Exception as exc:
        logger.error("LLM classification failed: %s", exc)
        return settings.default_fallback_category

    # Parse JSON from the response
    try:
        parsed: dict[str, Any] = json.loads(content)
    except json.JSONDecodeError:
        logger.warning("LLM returned non-JSON: %r — stripping fencing and retrying", content[:120])
        # Some models wrap JSON in ```json ... ``` fences — try to extract
        cleaned = _strip_fences(content)
        try:
            parsed = json.loads(cleaned)
        except json.JSONDecodeError:
            logger.error("LLM response not parseable as JSON after fence-stripping: %r", cleaned[:120])
            return settings.default_fallback_category

    raw_category = parsed.get("category", "")
    category = normalize_category(raw_category)
    logger.debug("Classified: %r → %s (raw=%r)", subject[:60], category, raw_category)
    return category


def _strip_fences(text: str) -> str:
    """Strip markdown code fences from a JSON string."""
    lines = text.strip().splitlines()
    # Remove leading ```json / ``` lines and trailing ``` lines
    cleaned = [line for line in lines if not line.strip().startswith("```")]
    return "\n".join(cleaned).strip()
