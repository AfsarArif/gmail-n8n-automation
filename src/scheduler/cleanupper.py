"""Batch cleanup — process all historical unlabeled emails in batches of 500."""
import logging
from typing import Callable
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

def run_cleanup(progress_callback: Callable[[dict], None] | None = None) -> int:
    """Process ALL unlabeled emails. Returns total count processed."""
    logger.info("Starting historical cleanup...")

    # ── Self-correction: detect label drift from previous classifications ──
    try:
        from src.classifier.correction_learner import detect_label_drift, apply_learned_corrections
        drift_count = detect_label_drift(progress_callback=progress_callback)
        if drift_count > 0:
            logger.info("Label drift detected: %d correction(s) found", drift_count)
        learned = apply_learned_corrections()
        if learned:
            logger.info("Learned domain corrections available: %s", learned)
    except Exception as exc:
        logger.warning("Correction learning skipped (non-fatal): %s", exc)

    total = 0
    page_token = None
    batch = 0

    while True:
        batch += 1
        messages, page_token = _fetch_batch(page_token)

        if not messages:
            logger.info("No more unlabeled messages. Total processed: %d", total)
            break

        if progress_callback:
            progress_callback({
                "event": "batch_start",
                "batch": batch,
                "total_in_batch": len(messages),
            })
        logger.info("Starting batch %d (%d unlabeled emails)...", batch, len(messages))

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
                if result.get("error"):
                    logger.error(
                        "Label apply failed for %s (category=%s): %s — skipping mark_processed for retry",
                        msg_id, result.get("final_category", "?"), result["error"],
                    )
                    if progress_callback:
                        progress_callback({
                            "event": "error",
                            "message": f"Label apply failed for {msg_id}: {result['error']}",
                            "msg_id": msg_id,
                        })
                    continue
                category = result.get("final_category", "fyi")
                mark_processed(msg_id, thread_id, category, gmail_msg.from_address, gmail_msg.subject)
                processed += 1
            except Exception as exc:
                logger.error(
                    "Failed to classify email %s (from: %s, subject: \"%s\") — %s: %s",
                    msg_id,
                    gmail_msg.from_address if gmail_msg else "unknown",
                    (gmail_msg.subject[:80] if gmail_msg and gmail_msg.subject else "unknown"),
                    type(exc).__name__,
                    exc,
                )
                if progress_callback:
                    progress_callback({
                        "event": "error",
                        "message": f"Failed to classify email {msg_id} (from: {gmail_msg.from_address if gmail_msg else 'unknown'}, subject: \"{(gmail_msg.subject[:80] if gmail_msg and gmail_msg.subject else 'unknown')}\") — {type(exc).__name__}: {exc}",
                        "msg_id": msg_id,
                    })

        total += processed
        if progress_callback:
            progress_callback({
                "event": "batch_done",
                "batch": batch,
                "processed": processed,
                "total_in_batch": len(messages),
                "running_total": total,
            })
        logger.info("Batch %d complete: %d/%d emails processed (skipped %d already-done). Running total: %d",
                     batch, processed, len(messages), len(messages) - processed, total)

        if not page_token:
            break

    if progress_callback:
        progress_callback({"event": "finished", "total": total})
    logger.info("Cleanup complete. Total classified: %d", total)
    return total
