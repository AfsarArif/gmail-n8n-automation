"""
Label drift detection and correction learning.

Scans recently processed emails for manual Gmail label changes (user
re-labeled or removed the AI/* label), records corrections, and
auto-learns sender-domain → category mappings for the pre-classifier.
"""

import logging
from typing import Callable

from src.gmail.client import get_message
from src.gmail.labels import AI_LABELS
from src.persistence.tracker import (
    get_connection,
    is_processed,
    record_correction,
    get_learned_domains,
)

logger = logging.getLogger(__name__)


def extract_domain(from_address: str) -> str:
    """Extract the domain part from a From: address.

    Examples:
        extract_domain("Timex <news@timex.com>") → "timex.com"
        extract_domain("noreply@mail.linkedin.com") → "mail.linkedin.com"
    """
    addr = from_address.strip()
    # Handle "Name <email>" format
    if "<" in addr and ">" in addr:
        start = addr.rfind("<") + 1
        end = addr.rfind(">")
        addr = addr[start:end].strip()
    # Extract domain from email
    if "@" in addr:
        return addr.split("@")[1].lower()
    return addr.lower()


def detect_label_drift(
    progress_callback: Callable[[dict], None] | None = None,
    days: int = 7,
) -> int:
    """
    Scan recently processed emails for manual Gmail label changes.

    For each email in processed_emails (last N days):
    1. Fetch current labels from Gmail
    2. If the AI/<category> label we applied is MISSING → user removed it
    3. If a DIFFERENT AI/<category> label is present → user re-categorized
    4. Record the correction with sender domain

    Returns number of corrections detected.
    """
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT message_id, category, from_address
        FROM processed_emails
        WHERE processed_at >= datetime('now', ?)
        ORDER BY processed_at DESC
        """,
        (f"-{days} days",),
    ).fetchall()

    if not rows:
        logger.info("No recent emails to check for label drift")
        return 0

    corrections_found = 0
    ai_label_names = set(AI_LABELS.values())  # {"AI/Newsletter", "AI/Action-Required", ...}
    category_to_label = {k: v for k, v in AI_LABELS.items()}  # {"newsletter": "AI/Newsletter", ...}
    label_to_category = {v: k for k, v in AI_LABELS.items()}  # {"AI/Newsletter": "newsletter", ...}

    for row in rows:
        msg_id = row[0]
        original_category = row[1]
        from_address = row[2]

        # Fetch current Gmail labels
        try:
            gmail_msg = get_message(msg_id)
            if gmail_msg is None:
                continue
            current_labels = set(gmail_msg.label_ids)
        except Exception as exc:
            logger.debug("Failed to fetch current labels for %s: %s", msg_id, exc)
            continue

        # Check what AI labels are currently on this email
        current_ai_labels = ai_label_names & current_labels

        # Determine the corrected category (if any)
        expected_label = category_to_label.get(original_category, f"AI/{original_category.title()}")

        if expected_label not in current_labels:
            # User removed our label — find what they replaced it with
            corrected_label = None
            for ai_label in current_ai_labels:
                corrected_category = label_to_category.get(ai_label)
                if corrected_category and corrected_category != original_category:
                    corrected_label = ai_label
                    break

            from_domain = extract_domain(from_address)
            detected_label = corrected_label or "REMOVED"

            record_correction(msg_id, from_domain, original_category, detected_label)
            corrections_found += 1
            logger.info(
                "Correction detected: %s (%s) was %s → now %s",
                msg_id, from_domain, original_category, detected_label,
            )

        if progress_callback and corrections_found > 0:
            progress_callback({
                "event": "correction_progress",
                "checked": rows.index(row) + 1,
                "total": len(rows),
                "corrections": corrections_found,
            })

    logger.info("Drift check complete: %d corrections found in %d emails", corrections_found, len(rows))
    return corrections_found


def apply_learned_corrections(min_corrections: int = 2) -> dict[str, str]:
    """
    Check the corrections table for domains with enough consistent corrections.

    Returns {domain: corrected_category} for domains that should have their
    pre-classifier rule updated. The caller should review these before
    applying them to the pre-classifier domain lists.

    Args:
        min_corrections: Minimum number of consistent corrections needed
                         before a domain is considered "learned".

    Returns:
        Dict mapping domain → new category.
    """
    learned = get_learned_domains(min_corrections)
    if learned:
        logger.info("Learned corrections ready: %d domain(s)", len(learned))
        for domain, category in learned.items():
            logger.info("  %s → %s", domain, category)
    else:
        logger.info("No learned corrections ready (need ≥%d consistent corrections)", min_corrections)
    return learned
