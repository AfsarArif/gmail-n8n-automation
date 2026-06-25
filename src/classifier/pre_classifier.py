"""
Sender-domain pre-classifier.

Checks the `from` address against known sender-domain rules to assign a
fast category and potentially skip the AI classification path. This avoids
burning DeepSeek tokens on predictable emails (~35% of emails skip AI).

Ported from src/code/pre-classifier.ts.
"""

from dataclasses import dataclass
from typing import Optional

# ─────────────────────────────────────────────
# Domain rule sets
# ─────────────────────────────────────────────

SOCIAL_DOMAINS: tuple[str, ...] = (
    "linkedin.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "reddit.com",
    "github.com",
    "discord.com",
    "meetup.com",
    "slack.com",
)

CAREER_DOMAINS: tuple[str, ...] = (
    "indeed.com",
    "glassdoor.com",
    "levels.fyi",
    "ziprecruiter.com",
    "dice.com",
    "hired.com",
    "greenhouse.io",
    "lever.co",
    "workday.com",
    "myworkdayjobs.com",
    "wellfound.com",
    "otta.com",
)

FYI_DOMAINS: tuple[str, ...] = (
    "amazon.com",
    "apple.com",
    "paypal.com",
    "stripe.com",
    "shopify.com",
    "ebay.com",
    "bestbuy.com",
    "ups.com",
    "fedex.com",
    "usps.com",
)

NEWSLETTER_DOMAINS: tuple[str, ...] = (
    "substack.com",
    "beehiiv.com",
    "convertkit.com",
    "mailchimp.com",
    "klaviyo.com",
    "sendgrid.net",
    "constantcontact.com",
)

# ─────────────────────────────────────────────
# Compiled rule list (ordered — first match wins)
# ─────────────────────────────────────────────

DOMAIN_RULES: tuple[tuple[tuple[str, ...], str], ...] = (
    (SOCIAL_DOMAINS, "social"),
    (CAREER_DOMAINS, "career"),
    (FYI_DOMAINS, "fyi"),
    (NEWSLETTER_DOMAINS, "newsletter"),
)

# ─────────────────────────────────────────────
# Result type
# ─────────────────────────────────────────────


@dataclass
class PreClassifyResult:
    """Result of domain-based pre-classification."""

    category: Optional[str]
    """Fast-track category when the sender domain is recognised, or None."""

    skip_ai: bool
    """When True the caller may skip the AI classification path entirely."""


# ─────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────

def pre_classify(from_address: str) -> PreClassifyResult:
    """
    Classify an email by sender domain alone.

    Rules are evaluated in order (social → career → fyi → newsletter).
    The **first** matching rule wins. If no domain matches we return
    ``category=None, skip_ai=False`` so the caller falls through to the
    DeepSeek path.

    Args:
        from_address: The ``From:`` header value (case-insensitive match).

    Returns:
        A ``PreClassifyResult`` with the fast category (if any).
    """
    from_lower = from_address.lower().strip()

    # Empty / missing sender — can't classify, let AI handle it.
    if not from_lower:
        return PreClassifyResult(category=None, skip_ai=False)

    for domains, category in DOMAIN_RULES:
        if any(domain in from_lower for domain in domains):
            return PreClassifyResult(category=category, skip_ai=True)

    return PreClassifyResult(category=None, skip_ai=False)
