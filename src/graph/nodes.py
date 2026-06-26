"""
LangGraph node functions for the email classification workflow.

Each node receives the current ``EmailState`` as a dictionary and returns a
dictionary of fields to merge into the state.
"""

import logging

from src.classifier.llm_classifier import classify as llm_classify
from src.classifier.pre_classifier import pre_classify
from src.config import settings
from src.gmail.client import add_label, archive_message, mark_read
from src.gmail.labels import get_label_id
from src.graph.state import EmailState

logger = logging.getLogger(__name__)


def pre_classify_node(state: EmailState) -> dict:
    """Run the domain-based pre-classifier.

    Updates state with ``pre_category`` and ``skip_ai``.

    Args:
        state: Current email state.

    Returns:
        Dict with ``pre_category`` and ``skip_ai`` keys.
    """
    result = pre_classify(state["from_address"])
    logger.debug(
        "Pre-classify %r → category=%s skip_ai=%s",
        state["from_address"],
        result.category,
        result.skip_ai,
    )
    return {"pre_category": result.category, "skip_ai": result.skip_ai}


def llm_classify_node(state: EmailState) -> dict:
    """Run DeepSeek LLM classification when the pre-classifier didn't match.

    Args:
        state: Current email state.

    Returns:
        Dict with ``llm_category`` key.
    """
    body_preview = state.get("body_plain", "")[:600]
    cat = llm_classify(
        state["from_address"],
        state["subject"],
        body_preview,
        state.get("existing_label_ids", []),
    )
    logger.debug("LLM classify → %s", cat)
    return {"llm_category": cat}


def normalize_node(state: EmailState) -> dict:
    """Determine the final category.

    Preference order:
        1. Pre-classifier result (if any).
        2. LLM classifier result (if called).
        3. Default fallback category from settings.

    Args:
        state: Current email state.

    Returns:
        Dict with ``final_category`` key.
    """
    final = (
        state.get("pre_category")
        or state.get("llm_category")
        or settings.default_fallback_category
    )
    # Safety net: Gmail IMPORTANT emails must never be classified as spam or promotions
    # (promotions get auto-archived, which hides important mail from the user)
    important_labels = {"IMPORTANT"}
    existing = set(state.get("existing_label_ids", []))
    if important_labels & existing:
        if final == "spam":
            logger.info("Overriding spam->fyi for IMPORTANT email %s", state.get("message_id"))
            final = "fyi"
        elif final == "promotions":
            logger.info("Overriding promotions->fyi for IMPORTANT email %s", state.get("message_id"))
            final = "fyi"

    logger.debug("Final category: %s", final)
    return {"final_category": final}


def determine_actions_node(state: EmailState) -> dict:
    """Determine what Gmail actions to take based on the final category.

    No state mutations are needed here — the logic is currently embedded
    directly in the ``apply_gmail_node``.  This node serves as a semantic
    placeholder for future action-plan extraction.

    Args:
        state: Current email state.

    Returns:
        Empty dict (no state changes).
    """
    return {}


def apply_gmail_node(state: EmailState) -> dict:
    """Apply Gmail labels, mark-as-read, and archive based on final category.

    Behaviour (ported from ``src/code/label-mapper.ts``):

    *   **Label**: All categories get their ``AI/<Category>`` label applied.
    *   **Mark read**: Applied to every category EXCEPT ``action`` and
        ``career`` (so ``otp``, ``social``, ``promotions``, ``newsletter``,
        ``fyi``, and ``spam`` are all marked read).
    *   **Archive**: Applied ONLY to ``promotions`` (``otp`` is NOT archived).

    Args:
        state: Current email state.

    Returns:
        Empty dict (no state changes).
    """
    msg_id = state["message_id"]
    category = state["final_category"]

    # Apply label
    label_id = get_label_id(category)
    if label_id:
        try:
            add_label(msg_id, label_id)
            logger.debug("Applied label %s to %s", label_id, msg_id)
        except Exception as exc:
            logger.error("Failed to apply label %s to %s: %s", label_id, msg_id, exc)
            return {"error": str(exc)}
    else:
        logger.warning("No label ID found for category %r on %s", category, msg_id)

    # Mark as read (skip for action and career)
    if category not in ("action", "career"):
        try:
            mark_read(msg_id)
            logger.debug("Marked %s as read", msg_id)
        except Exception as exc:
            logger.error("Failed to mark %s as read: %s", msg_id, exc)

    # Archive (promotions only)
    if category == "promotions":
        try:
            archive_message(msg_id)
            logger.debug("Archived %s", msg_id)
        except Exception as exc:
            logger.error("Failed to archive %s: %s", msg_id, exc)

    return {}
