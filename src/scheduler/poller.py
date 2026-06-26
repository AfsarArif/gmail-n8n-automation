"""Continuous Gmail poller — fetches unlabeled emails and classifies them via LangGraph."""
import logging
import time
from datetime import datetime, timezone
from src.config import settings
from src.gmail.client import list_unlabeled_messages, get_message
from src.graph.workflow import email_graph
from src.graph.state import EmailState
from src.persistence.tracker import is_processed, mark_processed, update_last_poll_time, get_processed_count, purge_old_entries

logger = logging.getLogger(__name__)

def poll_once() -> int:
    """Fetch and classify one batch of unlabeled emails. Returns count processed."""
    messages, next_token = list_unlabeled_messages(max_results=10)
    update_last_poll_time()
    if not messages:
        logger.info("No unlabeled messages found")
        return 0

    processed = 0
    for msg in messages:
        msg_id = msg["id"]
        thread_id = msg["threadId"]

        # Skip if already processed (secondary dedup)
        if is_processed(msg_id):
            continue

        # Fetch full message
        gmail_msg = get_message(msg_id)
        if gmail_msg is None:
            continue

        # Classify via LangGraph
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
            if result.get("error"):
                logger.error(
                    "Label apply failed for %s (category=%s): %s — skipping mark_processed for retry",
                    msg_id, result.get("final_category", "?"), result["error"],
                )
                continue
            category = result.get("final_category", "fyi")
            mark_processed(msg_id, thread_id, category, gmail_msg.from_address, gmail_msg.subject)
            processed += 1
            logger.info("Classified %s → %s (from: %s)", msg_id, category, gmail_msg.from_address)
        except Exception as exc:
            logger.error("Failed to classify %s: %s", msg_id, exc)

    return processed

def run_poller() -> None:
    """Run the continuous poll loop. Press Ctrl+C to stop."""
    logger.info("Starting Gmail poller (interval: %d min)", settings.gmail_poll_interval_minutes)
    purge_old_entries()

    while True:
        try:
            count = poll_once()
            if count:
                logger.info("Poll cycle complete: %d emails processed. Total today: %d",
                           count, get_processed_count())
            time.sleep(settings.gmail_poll_interval_minutes * 60)
        except KeyboardInterrupt:
            logger.info("Poller stopped by user")
            break
        except Exception as exc:
            logger.error("Poll cycle error: %s — retrying in 30s", exc)
            time.sleep(30)
