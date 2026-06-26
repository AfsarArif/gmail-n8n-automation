"""
DeepSeek-powered email classifier.

Uses LangChain's ChatOpenAI (with DeepSeek's OpenAI-compatible API) to
classify emails into one of eight categories.  Falls back to "fyi" on
parse errors or unexpected categories.

Ported from src/code/classifier.ts.
"""

import json
import logging
import threading
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
    "otp",
)

CLASSIFICATION_SYSTEM_PROMPT = """You are an email classifier. Return valid JSON only — no markdown, no explanation, no extra text.

Classify by the email's PRIMARY PURPOSE:

- "otp":          One-time passcodes, verification codes, 2FA login tokens, account confirmation codes
- "action":       Requires a direct reply or response — questions, meeting invites, tasks, requests for information
- "social":       Social interaction alerts — likes, comments, follows, connection requests, mentions, DMs, group activity
- "promotions":   Marketing or sales content from ANY sender — discount codes, limited-time offers, product launches, seasonal sales, brand campaigns, "shop now" CTAs
- "career":       Job postings, recruiter outreach, interview requests, application status updates, job alerts
- "newsletter":   Editorial content — blog digests, curated reading lists, publication emails, long-form articles
- "fyi":          Transactional notifications — receipts, order confirmations, shipping updates, password resets, account alerts, no-reply notifications
- "spam":         Junk mail, phishing attempts, unsolicited bulk, obvious scams

CRITICAL RULES:
1. **Content beats sender.** A marketing email from LinkedIn is "promotions", not "social". An order confirmation from Nike is "fyi", not "promotions".
2. **"social" is ONLY for interaction alerts.** "Follow us on Instagram" inside a brand email does NOT make it social. Social means: someone liked your post, commented, sent a connection request, mentioned you, invited you to a group, etc.
3. **Gmail labels are strong hints:**
   - CATEGORY_PROMOTIONS → almost certainly "promotions"
   - CATEGORY_SOCIAL → "social" only if about interactions; if it promotes a product/service → "promotions"
   - CATEGORY_UPDATES → likely "fyi" or "newsletter"
   - IMPORTANT → never "spam", prefer "action" or "fyi"
4. **Newsletter vs Promotions:** If the email promotes a product/service/sale → "promotions". If purely editorial/educational → "newsletter".
5. **FYI vs Promotions:** Receipts, order confirmations, shipping notifications → "fyi" (even from retailers). Marketing content from retailers → "promotions".

Return exactly this JSON:
{
  "category": "newsletter|action|social|promotions|career|fyi|spam|otp"
}"""

# ─────────────────────────────────────────────
# Internally cached LLM instance
# ─────────────────────────────────────────────

_llm: ChatOpenAI | None = None
_llm_lock = threading.Lock()


def _get_llm() -> ChatOpenAI:
    """Lazy-initialise the DeepSeek LLM client (thread-safe)."""
    global _llm
    if _llm is None:
        with _llm_lock:
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


def build_classification_prompt(
    from_addr: str,
    subject: str,
    body_preview: str,
    existing_label_ids: list[str] | None = None,
) -> str:
    """Build the user-facing prompt from email fields.

    Args:
        from_addr: The ``From:`` header value.
        subject: The ``Subject:`` header value.
        body_preview: First ~600 characters of the plain-text body.
        existing_label_ids: Optional list of Gmail label IDs already on the email.

    Returns:
        A plain-text prompt string.
    """
    prompt = f"From: {from_addr}\nSubject: {subject}\nBody preview: {body_preview}"
    if existing_label_ids:
        # Filter to only show relevant system labels (not AI/* labels)
        system_labels = [l for l in existing_label_ids if not l.startswith("AI/")]
        if system_labels:
            prompt += f"\nGmail system labels: {', '.join(system_labels)}"
    return prompt


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


def classify(from_addr: str, subject: str, body_preview: str, existing_label_ids: list[str] | None = None) -> str:
    """Run DeepSeek classification on email fields.

    Args:
        from_addr: The ``From:`` header value.
        subject: The ``Subject:`` header value.
        body_preview: First ~300 characters of the plain-text body.
        existing_label_ids: Optional list of Gmail label IDs already on the email.

    Returns:
        Normalised category string (one of ``VALID_CATEGORIES``).
    """
    llm = _get_llm()

    messages = [
        SystemMessage(content=CLASSIFICATION_SYSTEM_PROMPT),
        HumanMessage(content=build_classification_prompt(from_addr, subject, body_preview, existing_label_ids)),
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
