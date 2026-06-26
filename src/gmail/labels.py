"""
Gmail label management.

Maintains a cached mapping of label name → label ID, with automatic
refresh. Provides ensure_labels_exist() to create the 8 AI/* labels
if they don't already exist.
"""

import logging
import time
from typing import Optional

from googleapiclient.errors import HttpError

from src.gmail.auth import get_credentials
from src.gmail.client import get_service

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# Label definitions
# ─────────────────────────────────────────────

# The eight AI classification labels (Gmail format: AI/CategoryName)
AI_LABELS: dict[str, str] = {
    "newsletter": "AI/Newsletter",
    "action": "AI/Action-Required",
    "social": "AI/Social",
    "promotions": "AI/Promotions",
    "career": "AI/Career",
    "fyi": "AI/FYI",
    "spam": "AI/Spam",
    "otp": "AI/OTP",
}

# Category → full label name (reverse map of AI_LABELS values → keys)
CATEGORY_TO_LABEL: dict[str, str] = {v: k for k, v in AI_LABELS.items()}
CATEGORY_TO_LABEL.update(AI_LABELS)  # Also allow key→value lookup

# ─────────────────────────────────────────────
# Label ID cache
# ─────────────────────────────────────────────

_label_cache: dict[str, str] = {}
_last_refresh: float = 0.0
_CACHE_TTL_SECONDS: int = 300  # 5 minutes


def get_label_id(category: str) -> Optional[str]:
    """
    Get the Gmail label ID for a category.

    Looks up the cached name→ID mapping, refreshing if the cache is stale.
    Returns None if the label doesn't exist yet.

    Args:
        category: Category key (e.g., 'newsletter', 'action', 'spam').

    Returns:
        Gmail label ID string, or None.
    """
    _refresh_if_stale()
    label_name = AI_LABELS.get(category, category)
    return _label_cache.get(label_name)


def get_label_ids(categories: list[str]) -> list[str]:
    """
    Get Gmail label IDs for multiple categories, skipping unknowns.

    Args:
        categories: List of category keys.

    Returns:
        List of valid Gmail label ID strings.
    """
    _refresh_if_stale()
    result: list[str] = []
    for cat in categories:
        lid = get_label_id(cat)
        if lid:
            result.append(lid)
        else:
            logger.warning("No label ID found for category %r", cat)
    return result


def _refresh_if_stale() -> None:
    """Refresh the label cache if it's older than TTL."""
    global _label_cache, _last_refresh
    now = time.time()
    if now - _last_refresh < _CACHE_TTL_SECONDS and _label_cache:
        return
    _label_cache = _fetch_all_labels()
    _last_refresh = now
    logger.debug("Label cache refreshed: %d labels", len(_label_cache))


def _fetch_all_labels() -> dict[str, str]:
    """Fetch all Gmail labels and return name→ID mapping."""
    service = get_service()
    label_map: dict[str, str] = {}
    try:
        response = service.users().labels().list(userId="me").execute()
        for label in response.get("labels", []):
            label_map[label["name"]] = label["id"]
        logger.info("Fetched %d Gmail labels", len(label_map))
    except HttpError as exc:
        logger.error("Failed to fetch Gmail labels: %s", exc)
        raise
    return label_map


def force_refresh_labels() -> dict[str, str]:
    """Force an immediate refresh of the label cache. Returns the new mapping."""
    global _label_cache, _last_refresh
    _label_cache = _fetch_all_labels()
    _last_refresh = time.time()
    return dict(_label_cache)


# ─────────────────────────────────────────────
# Label creation
# ─────────────────────────────────────────────

def ensure_labels_exist() -> dict[str, str]:
    """
    Ensure all 8 AI/* labels exist in Gmail, creating any that are missing.

    Returns:
        Dict mapping category key → label ID for all AI labels.

    Raises:
        RuntimeError: If a label cannot be created after retries.
    """
    service = get_service()
    existing = _fetch_all_labels()
    created_count = 0
    result: dict[str, str] = {}

    for category, label_name in AI_LABELS.items():
        if label_name in existing:
            result[category] = existing[label_name]
            logger.info("✓ Label exists: %s (%s)", label_name, existing[label_name])
            continue

        # Create missing label
        try:
            created = (
                service.users()
                .labels()
                .create(
                    userId="me",
                    body={
                        "name": label_name,
                        "labelListVisibility": "labelShow",
                        "messageListVisibility": "show",
                        "color": _label_color(category),
                    },
                )
                .execute()
            )
            result[category] = created["id"]
            created_count += 1
            logger.info("✓ Created label: %s (%s)", label_name, created["id"])
        except HttpError as exc:
            logger.error("Failed to create label %s: %s", label_name, exc)
            raise RuntimeError(f"Could not create label {label_name}: {exc}") from exc

    # Refresh cache
    global _label_cache, _last_refresh
    _label_cache = _fetch_all_labels()
    _last_refresh = time.time()

    if created_count:
        logger.info("Created %d new AI labels", created_count)
    else:
        logger.info("All AI labels already exist (no new labels created)")

    return result


def _label_color(category: str) -> dict:
    """Return a Gmail label color for a category."""
    colors = {
        "action": {"backgroundColor": "#e3c5fc", "textColor": "#3d185e"},    # Purple
        "newsletter": {"backgroundColor": "#c2e4f7", "textColor": "#1a3d5c"}, # Blue
        "social": {"backgroundColor": "#fad2cf", "textColor": "#691717"},     # Red
        "promotions": {"backgroundColor": "#fde6a1", "textColor": "#5c4100"}, # Yellow
        "career": {"backgroundColor": "#d3e5d0", "textColor": "#1a3d1a"},     # Green
        "fyi": {"backgroundColor": "#e8eaed", "textColor": "#3a3a3a"},        # Grey
        "spam": {"backgroundColor": "#f28b82", "textColor": "#3a0000"},       # Dark red
        "otp": {"backgroundColor": "#fde0c2", "textColor": "#5c3000"},       # Amber/Orange
    }
    return colors.get(category, {"backgroundColor": "#e8eaed", "textColor": "#3a3a3a"})
