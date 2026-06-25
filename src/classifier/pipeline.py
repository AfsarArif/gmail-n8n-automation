"""
Combined classification pipeline.

Orchestrates the pre-classifier and LLM classifier into a single call,
returning the final category and a flag indicating whether AI was used.
"""

import logging

from src.classifier.llm_classifier import classify as llm_classify
from src.classifier.pre_classifier import pre_classify
from src.config import settings

logger = logging.getLogger(__name__)


def classify_email(from_addr: str, subject: str, body_plain: str) -> tuple[str, bool]:
    """Run the full classification pipeline.

    Tries the sender-domain pre-classifier first.  If the pre-classifier
    matches a known domain (``skip_ai=True``) the LLM is skipped entirely.
    Otherwise the email is sent to DeepSeek for classification.

    Args:
        from_addr: The ``From:`` header value.
        subject: The ``Subject:`` header value.
        body_plain: The full plain-text body of the email.

    Returns:
        Tuple of ``(category: str, used_ai: bool)``.
        ``used_ai`` is ``True`` when DeepSeek was called, ``False`` when
        the pre-classifier handled it.
    """
    # 1. Pre-classifier (domain-based fast path)
    pre_result = pre_classify(from_addr)

    if pre_result.skip_ai:
        category = pre_result.category or settings.default_fallback_category
        logger.debug(
            "Pre-classifier matched: %r → %s (AI skipped)",
            from_addr,
            category,
        )
        return category, False

    # 2. LLM classifier (DeepSeek)
    logger.debug(
        "Pre-classifier did not match %r — calling DeepSeek",
        from_addr,
    )
    body_preview = body_plain[:300] if body_plain else ""
    category = llm_classify(from_addr, subject, body_preview)
    return category, True
