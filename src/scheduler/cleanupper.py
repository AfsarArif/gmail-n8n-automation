"""Batch cleanup — process all historical unlabeled emails in batches of 500."""
import logging
from tenacity import retry, stop_after_attempt, wait_exponential
from src.config import settings
from src.gmail.client import list_unlabeled_messages, get_message
from src.graph.workflow import email_graph
from src.graph.state import EmailState
from src.persistence.tracker import is_processed, mark_processed, get_processed_count

logger = logging.getLogger(__name__)

@retry(
    stop=stop_after_attempt(settings.max_retries),
    wait=wait_exponential(multiplier=1, min=2, max=30),
)
def _fetch_batch(page_token: str | None = None):
    """Fetch a batch with retry on 429."""
    return list_unlabeled_messages(max_results=500, page_token=page_token)

def run_cleanup() -> int:
    """Process ALL unlabeled emails. Returns total count processed."""
    logger.info("Starting historical cleanup...")
    total = 0
    page_token = None
    batch = 0

    while True:
        batch += 1
        messages, page_token = _fetch_batch(page_token)

        if not messages:
            logger.info("No more unlabeled messages. Total processed: %d", total)
            break

        processed = 0
        for msg in messages:
            msg_id = msg["id"]
            thread_id = msg["threadId"]

            if is_processed(msg_id):
                continue

            gmail_msg = get_message(msg_id)
            if gmail_msg is None:
                continue

            state: EmailState = {
                "message_id": gmail_msg.id,
                "thread_id": gmail_msg.thread_id,
                "from_address": gmail_msg.from_address,
                "subject": gmail_msg.subject,
                "body_plain": gmail_msg.body_plain,
                "existing_label_ids": gmail_msg.label_ids,
                "pre_category": None,
                "skip_ai": False,
                "llm_category": None,
                "final_category": "",
                "error": None,
            }

            try:
                result = email_graph.invoke(state)
                category = result.get("final_category", "fyi")
                mark_processed(msg_id, thread_id, category, gmail_msg.from_address, gmail_msg.subject)
                processed += 1
            except Exception as exc:
                logger.error("Failed to classify %s: %s", msg_id, exc)

        total += processed
        logger.info("Batch %d: %d/%d processed. Total: %d", batch, processed, len(messages), total)

        if not page_token:
            break

    logger.info("Cleanup complete. Total classified: %d", total)
    return total
