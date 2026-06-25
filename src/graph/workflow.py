"""
LangGraph workflow definition for email classification.

Builds and compiles a ``StateGraph`` that chains five nodes:

    pre_classify → (llm_classify | normalize) → determine_actions → apply_gmail

The conditional edge after ``pre_classify`` skips the LLM when the
pre-classifier matched a known sender domain.
"""

import logging

from langgraph.graph import END, StateGraph

from src.graph.nodes import (
    apply_gmail_node,
    determine_actions_node,
    llm_classify_node,
    normalize_node,
    pre_classify_node,
)
from src.graph.state import EmailState

logger = logging.getLogger(__name__)


def should_skip_ai(state: EmailState) -> str:
    """Conditional edge router.

    Returns ``"normalize"`` when the pre-classifier matched (``skip_ai`` is
    ``True``), causing the LLM node to be bypassed.  Otherwise returns
    ``"llm_classify"`` so DeepSeek is called.

    Args:
        state: Current email state after the pre-classify node.

    Returns:
        Name of the next node to execute.
    """
    if state.get("skip_ai"):
        logger.debug("Branch: skip AI → normalize")
        return "normalize"
    logger.debug("Branch: AI needed → llm_classify")
    return "llm_classify"


def build_workflow() -> StateGraph:
    """Build and compile the email classification workflow.

    Returns:
        A compiled ``StateGraph`` ready to ``invoke()`` with an
        ``EmailState`` dict.
    """
    workflow = StateGraph(EmailState)

    # ── Register nodes ────────────────────────
    workflow.add_node("pre_classify", pre_classify_node)
    workflow.add_node("llm_classify", llm_classify_node)
    workflow.add_node("normalize", normalize_node)
    workflow.add_node("determine_actions", determine_actions_node)
    workflow.add_node("apply_gmail", apply_gmail_node)

    # ── Entry point ───────────────────────────
    workflow.set_entry_point("pre_classify")

    # ── Edges ─────────────────────────────────
    workflow.add_conditional_edges(
        "pre_classify",
        should_skip_ai,
        {
            "normalize": "normalize",
            "llm_classify": "llm_classify",
        },
    )
    workflow.add_edge("llm_classify", "normalize")
    workflow.add_edge("normalize", "determine_actions")
    workflow.add_edge("determine_actions", "apply_gmail")
    workflow.add_edge("apply_gmail", END)

    logger.info("Email classification workflow built (%d nodes)", 5)
    return workflow.compile()


# Module-level compiled graph — import this directly for convenience.
email_graph = build_workflow()
