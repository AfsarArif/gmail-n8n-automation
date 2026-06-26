"""One-shot spam deletion — trash old spam messages."""
import logging
from src.config import settings
from src.gmail.client import list_ai_spam_messages, list_spam_messages, trash_message
from src.persistence.tracker import get_processed_count

logger = logging.getLogger(__name__)

def run_spam_delete(older_than_days: int | None = None) -> int:
    """Delete all spam older than configured days. Returns count deleted.

    Args:
        older_than_days: Override the configured spam age threshold.
                         Pass 0 to delete ALL spam regardless of age.
                         Pass None (default) to use the config value.
    """
    if older_than_days is None:
        older_days = settings.spam_older_than_days  # config default (1)
    else:
        older_days = older_than_days  # 0 = delete all spam
    batch_size = settings.spam_delete_batch_size

    logger.info("Deleting spam older than %d days (batch size: %d)...", older_days, batch_size)

    total = 0
    page_token = None
    batch = 0

    while True:
        batch += 1
        logger.info("Starting spam-delete batch %d (fetching up to %d spam messages)...", batch, batch_size)
        messages, page_token = list_spam_messages(
            older_than_days=older_days,
            max_results=batch_size,
            page_token=page_token,
        )

        if not messages:
            logger.info("No more spam to delete. Total deleted: %d", total)
            break

        for msg in messages:
            try:
                trash_message(msg["id"])
                total += 1
            except Exception as exc:
                logger.error("Failed to trash spam message %s — %s: %s", msg["id"], type(exc).__name__, exc)

        logger.info("Batch %d complete: %d spam messages trashed. Running total: %d", batch, len(messages), total)

        if not page_token:
            break

    # ── Also delete AI-classified spam (label:AI/Spam, still in inbox) ──
    page_token = None
    ai_batch = 0

    while True:
        ai_batch += 1
        logger.info("Starting AI-spam batch %d (fetching up to %d messages)...", ai_batch, batch_size)
        messages, page_token = list_ai_spam_messages(
            max_results=batch_size,
            page_token=page_token,
        )

        if not messages:
            logger.info("No more AI/Spam to delete. Running total: %d", total)
            break

        for msg in messages:
            try:
                trash_message(msg["id"])
                total += 1
            except Exception as exc:
                logger.error(
                    "Failed to trash AI/Spam message %s — %s: %s",
                    msg["id"], type(exc).__name__, exc,
                )

        logger.info(
            "AI-spam batch %d complete: %d messages trashed. Running total: %d",
            ai_batch, len(messages), total,
        )

        if not page_token:
            break

    logger.info("Spam deletion complete. Deleted: %d", total)
    return total
