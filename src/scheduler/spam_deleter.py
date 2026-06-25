"""One-shot spam deletion — trash old spam messages."""
import logging
from src.config import settings
from src.gmail.client import list_spam_messages, trash_message
from src.persistence.tracker import get_processed_count

logger = logging.getLogger(__name__)

def run_spam_delete() -> int:
    """Delete all spam older than configured days. Returns count deleted."""
    older_days = settings.spam_older_than_days
    batch_size = settings.spam_delete_batch_size

    logger.info("Deleting spam older than %d days (batch size: %d)...", older_days, batch_size)

    total = 0
    page_token = None
    batch = 0

    while True:
        batch += 1
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
                logger.error("Failed to trash %s: %s", msg["id"], exc)

        logger.info("Batch %d: %d spam messages trashed. Total: %d", batch, len(messages), total)

        if not page_token:
            break

    logger.info("Spam deletion complete. Deleted: %d", total)
    return total
