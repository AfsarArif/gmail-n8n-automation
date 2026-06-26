"""
Email processing tracker using SQLite.

Provides a secondary dedup layer (primary is Gmail query filter) and
tracks poller metadata like last-run timestamps.
"""

import logging
import os
import sqlite3
from datetime import datetime, timezone

from src.persistence.schema import init_db

logger = logging.getLogger(__name__)

# Lazy-initialised connection
_conn: sqlite3.Connection | None = None


def get_connection(db_path: str | None = None) -> sqlite3.Connection:
    """Return the shared SQLite connection, initialising if needed."""
    global _conn
    if _conn is None:
        if db_path is None:
            db_path = "/data/emailbot.db" if os.path.isdir("/data") else "emailbot.db"
        _conn = init_db(db_path)
    return _conn


# ─────────────────────────────────────────────
# Processed emails
# ─────────────────────────────────────────────

def is_processed(message_id: str) -> bool:
    """Check if a message has already been processed."""
    conn = get_connection()
    row = conn.execute(
        "SELECT 1 FROM processed_emails WHERE message_id = ?",
        (message_id,),
    ).fetchone()
    return row is not None


def mark_processed(
    message_id: str,
    thread_id: str,
    category: str,
    from_address: str,
    subject: str,
    label_applied: bool = True,
) -> None:
    """Record that a message has been classified and labelled."""
    conn = get_connection()
    conn.execute(
        """
        INSERT OR IGNORE INTO processed_emails
            (message_id, thread_id, category, from_address, subject, label_applied)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (
            message_id,
            thread_id,
            category,
            from_address,
            subject,
            1 if label_applied else 0,
        ),
    )
    conn.commit()


def get_processed_count(days: int = 1) -> int:
    """Count how many emails were processed in the last N days."""
    conn = get_connection()
    row = conn.execute(
        """
        SELECT COUNT(*) FROM processed_emails
        WHERE processed_at >= datetime('now', ?)
        """,
        (f"-{days} days",),
    ).fetchone()
    return row[0] if row else 0


def purge_old_entries(days: int = 30) -> int:
    """Delete processed entries older than N days. Returns count deleted."""
    conn = get_connection()
    cursor = conn.execute(
        "DELETE FROM processed_emails WHERE processed_at < datetime('now', ?)",
        (f"-{days} days",),
    )
    conn.commit()
    deleted = cursor.rowcount
    if deleted:
        logger.info("Purged %d old entries from processed_emails", deleted)
    return deleted


# ─────────────────────────────────────────────
# Metadata
# ─────────────────────────────────────────────

def get_metadata(key: str, default: str = "") -> str:
    """Get a metadata value by key."""
    conn = get_connection()
    row = conn.execute(
        "SELECT value FROM metadata WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else default


def set_metadata(key: str, value: str) -> None:
    """Set a metadata key-value pair."""
    conn = get_connection()
    conn.execute(
        """
        INSERT INTO metadata (key, value, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        """,
        (key, value),
    )
    conn.commit()


def update_last_poll_time() -> None:
    """Record the current UTC timestamp as the last poll time."""
    now = datetime.now(timezone.utc).isoformat()
    set_metadata("last_poll_time", now)


def get_last_poll_time() -> str:
    """Get the last poll timestamp, or empty string if never polled."""
    return get_metadata("last_poll_time", "")


# ─────────────────────────────────────────────
# Correction tracking (user re-labels in Gmail)
# ─────────────────────────────────────────────


def record_correction(
    message_id: str,
    from_domain: str,
    original_category: str,
    detected_label: str,
) -> None:
    """Record a detected label correction (user manually re-labeled in Gmail)."""
    conn = get_connection()
    conn.execute(
        """
        INSERT OR IGNORE INTO corrections
            (message_id, from_domain, original_category, detected_label)
        VALUES (?, ?, ?, ?)
        """,
        (message_id, from_domain, original_category, detected_label),
    )
    conn.commit()


def get_corrections_for_domain(from_domain: str, limit: int = 10) -> list[dict]:
    """Get correction history for a sender domain."""
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT message_id, original_category, detected_label, detected_at
        FROM corrections
        WHERE from_domain = ?
        ORDER BY detected_at DESC
        LIMIT ?
        """,
        (from_domain, limit),
    ).fetchall()
    return [
        {
            "message_id": row[0],
            "original_category": row[1],
            "detected_label": row[2],
            "detected_at": row[3],
        }
        for row in rows
    ]


def get_learned_domains(min_corrections: int = 2) -> dict[str, str]:
    """
    Return domains with enough consistent corrections to auto-update pre-classifier.

    Returns {domain: corrected_category} for domains where >=min_corrections
    corrections all point to the same new category.
    """
    conn = get_connection()
    rows = conn.execute(
        """
        SELECT from_domain, detected_label, COUNT(*) as cnt
        FROM corrections
        GROUP BY from_domain, detected_label
        HAVING cnt >= ?
        ORDER BY cnt DESC
        """,
        (min_corrections,),
    ).fetchall()
    return {row[0]: row[1] for row in rows}


def get_correction_count(days: int = 7) -> int:
    """Count corrections detected in the last N days."""
    conn = get_connection()
    row = conn.execute(
        """
        SELECT COUNT(*) FROM corrections
        WHERE detected_at >= datetime('now', ?)
        """,
        (f"-{days} days",),
    ).fetchone()
    return row[0] if row else 0
