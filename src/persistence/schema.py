"""
SQLite schema definitions for the email processing tracker.

Tables:
- processed_emails: Tracks which emails have been processed (secondary dedup).
- metadata: Arbitrary key-value store (poller timestamps, config, etc.).
"""

import sqlite3

DDL = """
CREATE TABLE IF NOT EXISTS processed_emails (
    message_id      TEXT PRIMARY KEY,
    thread_id       TEXT NOT NULL,
    category        TEXT NOT NULL,
    from_address    TEXT NOT NULL,
    subject         TEXT NOT NULL,
    processed_at    TEXT NOT NULL DEFAULT (datetime('now')),
    label_applied   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_processed_emails_thread
    ON processed_emails(thread_id);

CREATE INDEX IF NOT EXISTS idx_processed_emails_processed_at
    ON processed_emails(processed_at);

CREATE TABLE IF NOT EXISTS metadata (
    key             TEXT PRIMARY KEY,
    value           TEXT NOT NULL,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS corrections (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id          TEXT NOT NULL,
    from_domain         TEXT NOT NULL,
    original_category   TEXT NOT NULL,
    detected_label      TEXT NOT NULL,
    detected_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_corrections_domain
    ON corrections(from_domain);
"""


def init_db(db_path: str = "emailbot.db") -> sqlite3.Connection:
    """
    Initialise the SQLite database, creating tables if they don't exist.

    Uses check_same_thread=False so the connection can be shared across
    threads (background poller + FastAPI request handlers). WAL journal
    mode ensures safe concurrent reads.

    Args:
        db_path: Path to the SQLite database file.

    Returns:
        A thread-safe sqlite3.Connection with WAL journal mode enabled.
    """
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(DDL)
    conn.commit()
    return conn
