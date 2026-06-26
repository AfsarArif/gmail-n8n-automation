"""
Gmail API wrapper.

Provides typed, high-level methods for interacting with Gmail:
list messages, get message details, apply/remove labels, mark read, archive, trash.
"""

import base64
import logging
import threading
from email.header import decode_header
from email.parser import BytesParser
from email.policy import default as default_policy
from typing import Optional

from bs4 import BeautifulSoup
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from markdownify import markdownify as md

from src.gmail.auth import get_credentials

logger = logging.getLogger(__name__)

# Lazy-initialised singletons
_GMAIL_SERVICE = None
_service_lock = threading.Lock()


def get_service():
    """Return the cached Gmail API service instance, creating it on first call."""
    global _GMAIL_SERVICE
    if _GMAIL_SERVICE is None:
        with _service_lock:
            if _GMAIL_SERVICE is None:
                creds = get_credentials()
                _GMAIL_SERVICE = build("gmail", "v1", credentials=creds)
    return _GMAIL_SERVICE


# ─────────────────────────────────────────────
# Data models
# ─────────────────────────────────────────────

class GmailMessage:
    """Lightweight parsed Gmail message."""

    def __init__(
        self,
        msg_id: str,
        thread_id: str,
        from_address: str,
        subject: str,
        body_plain: str,
        label_ids: list[str],
        internal_date: str,
    ):
        self.id = msg_id
        self.thread_id = thread_id
        self.from_address = from_address
        self.subject = subject
        self.body_plain = body_plain
        self.label_ids = label_ids
        self.internal_date = internal_date

    @property
    def body_preview(self) -> str:
        """First ~300 characters of the plain-text body."""
        return self.body_plain[:300]


# ─────────────────────────────────────────────
# Message listing
# ─────────────────────────────────────────────

def list_unlabeled_messages(
    max_results: int = 500,
    page_token: Optional[str] = None,
) -> tuple[list[dict], Optional[str]]:
    """
    List messages that have no AI/* labels applied.

    Uses Gmail's query syntax to filter: messages in INBOX that do NOT have
    any of the AI/* labels. This is the primary dedup mechanism.

    Args:
        max_results: Maximum messages per page (Gmail API max is 500).
        page_token: Token for the next page, or None for first page.

    Returns:
        Tuple of (messages list, next_page_token or None).
    """
    query = (
        "in:inbox "
        "-label:AI/Newsletter "
        "-label:AI/Action-Required "
        "-label:AI/Social "
        "-label:AI/Promotions "
        "-label:AI/Career "
        "-label:AI/FYI "
        "-label:AI/OTP "
        "-label:AI/Spam"
    )
    return _list_messages(query, max_results, page_token)


def list_spam_messages(
    older_than_days: int = 1,
    max_results: int = 50,
    page_token: Optional[str] = None,
) -> tuple[list[dict], Optional[str]]:
    """
    List spam-labelled messages, optionally older than N days.

    Args:
        older_than_days: Only return messages older than this many days.
                         Use 0 to return ALL spam regardless of age.
        max_results: Maximum messages per page.
        page_token: Token for the next page, or None for first page.

    Returns:
        Tuple of (messages list, next_page_token or None).
    """
    if older_than_days > 0:
        query = f"label:spam older_than:{older_than_days}d"
    else:
        query = "label:spam"
    return _list_messages(query, max_results, page_token)


def list_ai_spam_messages(
    max_results: int = 50,
    page_token: Optional[str] = None,
) -> tuple[list[dict], Optional[str]]:
    """List messages with the AI/Spam label for deletion."""
    query = "label:AI/Spam"
    return _list_messages(query, max_results, page_token)


def _list_messages(
    query: str,
    max_results: int = 500,
    page_token: Optional[str] = None,
) -> tuple[list[dict], Optional[str]]:
    """Internal: execute a Gmail list query."""
    service = get_service()
    try:
        kwargs: dict = {
            "userId": "me",
            "q": query,
            "maxResults": min(max_results, 500),
            "fields": "messages(id,threadId),nextPageToken,resultSizeEstimate",
        }
        if page_token is not None:
            kwargs["pageToken"] = page_token
        response = (
            service.users()
            .messages()
            .list(**kwargs)
            .execute()
        )
    except HttpError as exc:
        logger.error("Gmail list query failed: %s", exc)
        raise

    messages = response.get("messages", [])
    next_token = response.get("nextPageToken")
    logger.info(
        "Listed %d messages (query=%r, nextPage=%s)",
        len(messages),
        query,
        bool(next_token),
    )
    return messages, next_token


# ─────────────────────────────────────────────
# Message retrieval
# ─────────────────────────────────────────────

def get_message(msg_id: str) -> Optional[GmailMessage]:
    """
    Fetch and parse a single Gmail message by ID.

    Returns None if the message doesn't exist or can't be retrieved.
    """
    service = get_service()
    try:
        response = (
            service.users()
            .messages()
            .get(
                userId="me",
                id=msg_id,
                format="raw",
                fields="id,threadId,labelIds,internalDate,raw,payload(headers)",
            )
            .execute()
        )
    except HttpError as exc:
        logger.error("Failed to fetch message %s: %s", msg_id, exc)
        return None

    return _parse_message(response)


def _parse_message(raw_msg: dict) -> Optional[GmailMessage]:
    """Parse a raw Gmail API message response into a GmailMessage."""
    msg_id = raw_msg.get("id", "")
    thread_id = raw_msg.get("threadId", "")
    label_ids = raw_msg.get("labelIds", [])
    internal_date = raw_msg.get("internalDate", "")

    payload = raw_msg.get("payload", {})
    from_address = ""
    subject = "(no subject)"

    # Extract body
    body_plain = ""
    raw_base64 = raw_msg.get("raw")
    if raw_base64:
        try:
            raw_bytes = base64.urlsafe_b64decode(raw_base64)
            msg = BytesParser(policy=default_policy).parsebytes(raw_bytes)
            body_plain = _extract_body(msg)
            from_address = _decode_header(msg.get("From", ""))
            subject = _decode_header(msg.get("Subject", "(no subject)"))
        except Exception as exc:
            logger.warning("Failed to parse raw body for %s: %s", msg_id, exc)
            body_plain = _extract_snippet(payload)

    return GmailMessage(
        msg_id=msg_id,
        thread_id=thread_id,
        from_address=from_address,
        subject=subject,
        body_plain=body_plain,
        label_ids=label_ids,
        internal_date=internal_date,
    )


def _decode_header(value: str) -> str:
    """Decode an RFC 2047 encoded email header."""
    parts = decode_header(value)
    result = ""
    for part, charset in parts:
        if isinstance(part, bytes):
            result += part.decode(charset or "utf-8", errors="replace")
        else:
            result += part
    return result


def _extract_body(msg) -> str:
    """Extract plain text from a parsed email message. Falls back to HTML→text."""
    # Try text/plain first
    if msg.is_multipart():
        for part in msg.walk():
            content_type = part.get_content_type()
            if content_type == "text/plain":
                payload = part.get_payload(decode=True)
                if payload:
                    return _decode_payload(payload)
        # Fallback: text/html → markdown
        for part in msg.walk():
            if part.get_content_type() == "text/html":
                payload = part.get_payload(decode=True)
                if payload:
                    html = _decode_payload(payload)
                    return md(html, strip=["img", "style", "script"]).strip()
    else:
        payload = msg.get_payload(decode=True)
        if payload:
            content_type = msg.get_content_type()
            if content_type == "text/html":
                html = _decode_payload(payload)
                return md(html, strip=["img", "style", "script"]).strip()
            return _decode_payload(payload)
    return ""


def _decode_payload(payload: bytes) -> str:
    """Decode payload bytes to string with fallback charsets."""
    for charset in ("utf-8", "latin-1", "cp1252"):
        try:
            return payload.decode(charset)
        except (UnicodeDecodeError, LookupError):
            continue
    return payload.decode("utf-8", errors="replace")


def _extract_snippet(payload: dict) -> str:
    """Fallback: extract body snippet from payload parts."""
    parts = []
    if "parts" in payload:
        for part in payload["parts"]:
            data = part.get("body", {}).get("data", "")
            if data:
                try:
                    parts.append(base64.urlsafe_b64decode(data).decode("utf-8", errors="replace"))
                except Exception:
                    pass
    body_data = payload.get("body", {}).get("data", "")
    if body_data:
        try:
            parts.append(base64.urlsafe_b64decode(body_data).decode("utf-8", errors="replace"))
        except Exception:
            pass
    return "\n".join(parts)


# ─────────────────────────────────────────────
# Label operations
# ─────────────────────────────────────────────

def add_label(msg_id: str, label_id: str) -> None:
    """Add a label to a message."""
    service = get_service()
    try:
        service.users().messages().modify(
            userId="me",
            id=msg_id,
            body={"addLabelIds": [label_id]},
        ).execute()
        logger.debug("Added label %s to message %s", label_id, msg_id)
    except HttpError as exc:
        logger.error("Failed to add label %s to %s: %s", label_id, msg_id, exc)
        raise


def remove_label(msg_id: str, label_id: str) -> None:
    """Remove a label from a message."""
    service = get_service()
    try:
        service.users().messages().modify(
            userId="me",
            id=msg_id,
            body={"removeLabelIds": [label_id]},
        ).execute()
        logger.debug("Removed label %s from message %s", label_id, msg_id)
    except HttpError as exc:
        logger.error("Failed to remove label %s from %s: %s", label_id, msg_id, exc)
        raise


def mark_read(msg_id: str) -> None:
    """Remove the UNREAD label from a message."""
    remove_label(msg_id, "UNREAD")


def archive_message(msg_id: str) -> None:
    """Archive a message by removing the INBOX label."""
    remove_label(msg_id, "INBOX")


def trash_message(msg_id: str) -> None:
    """Move a message to trash."""
    service = get_service()
    try:
        service.users().messages().trash(userId="me", id=msg_id).execute()
        logger.debug("Trashed message %s", msg_id)
    except HttpError as exc:
        logger.error("Failed to trash message %s: %s", msg_id, exc)
        raise
