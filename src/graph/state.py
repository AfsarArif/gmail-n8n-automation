"""
LangGraph state definition for single-email classification.

Each ``EmailState`` instance carries the data for one email through the
classification pipeline: pre-classify → (optional) LLM classify → normalize
→ determine actions → apply Gmail labels.
"""

from typing import Optional, TypedDict


class EmailState(TypedDict):
    """State for a single email classification run.

    Attributes:
        message_id: Gmail message ID.
        thread_id: Gmail thread ID.
        from_address: ``From:`` header value.
        subject: ``Subject:`` header value.
        body_plain: Full plain-text body of the email.
        existing_label_ids: Labels currently applied to the message.

        pre_category: Category assigned by the pre-classifier, if any.
        skip_ai: ``True`` when the pre-classifier matched and the LLM path
            should be skipped.
        llm_category: Category returned by DeepSeek, if called.
        final_category: Final resolved category after normalisation.

        error: Error message if something went wrong, else ``None``.
    """

    message_id: str
    thread_id: str
    from_address: str
    subject: str
    body_plain: str
    existing_label_ids: list[str]

    # Intermediate results
    pre_category: Optional[str]
    skip_ai: bool
    llm_category: Optional[str]
    final_category: str

    # Status
    error: Optional[str]
