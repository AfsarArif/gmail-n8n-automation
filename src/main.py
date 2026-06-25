"""EmailBot CLI — Gmail AI classification tool."""
import logging
import os
import sys
import time
import webbrowser
from typing import Optional

import httpx
import typer

app = typer.Typer(
    name="emailbot",
    help="Gmail AI classifier — classify, clean up, and manage your inbox with AI.",
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stderr,
)

logger = logging.getLogger("emailbot.cli")

# API client configuration
API_URL = os.environ.get("EMAILBOT_API_URL", "")
API_SECRET = os.environ.get("API_SECRET", "")


def _get_client() -> httpx.Client:
    """Create an httpx client with authentication headers."""
    headers = {}
    if API_SECRET:
        headers["X-API-Secret"] = API_SECRET
    return httpx.Client(base_url=API_URL, headers=headers, timeout=120)


def _call_api(endpoint: str) -> dict:
    """Call an API endpoint and handle errors."""
    if not API_URL:
        raise typer.Exit(
            "EMAILBOT_API_URL is not set. Set it to the deployed service URL, "
            "e.g. https://emailbot.fly.dev"
        )
    try:
        with _get_client() as client:
            resp = client.post(endpoint)
            resp.raise_for_status()
            return resp.json()
    except httpx.ConnectError:
        typer.echo(f"❌ Cannot reach {API_URL} — is the service running?")
        raise typer.Exit(1)
    except httpx.HTTPStatusError as exc:
        typer.echo(f"❌ API error: {exc.response.status_code} — {exc.response.text}")
        raise typer.Exit(1)


# ─────────────────────────────────────────────
# Auth command (web-based OAuth)
# ─────────────────────────────────────────────

@app.command()
def auth(
    login_url: Optional[str] = typer.Option(
        None,
        "--url",
        "-u",
        help="Override the login URL (default: $EMAILBOT_API_URL/login)",
    ),
    poll_interval: int = typer.Option(
        3, "--interval", "-i", help="Poll interval in seconds for token check"
    ),
) -> None:
    """Authenticate with Gmail via the deployed web service.

    Opens a browser to the OAuth login page. After you complete the Google
    consent flow, the token is saved both on the server and locally.
    """
    base = API_URL
    if login_url:
        base = login_url.rstrip("/")
    if not base:
        typer.echo("❌ Set EMAILBOT_API_URL or use --url to specify the login URL")
        raise typer.Exit(1)

    auth_url = f"{base}/login"
    status_url = f"{base}/auth-status"

    typer.echo(f"🌐 Opening browser for Gmail authentication...")
    typer.echo(f"   URL: {auth_url}")
    typer.echo("")
    typer.echo("   Complete the Google consent in your browser.")
    typer.echo("   Waiting for authentication to complete...")

    webbrowser.open(auth_url)

    # Poll for token
    dots = 0
    while True:
        try:
            with httpx.Client(timeout=10) as client:
                resp = client.get(status_url)
                data = resp.json()
                if data.get("authenticated"):
                    typer.echo("")
                    typer.echo("✅ Authentication successful!")
                    typer.echo(f"   Token saved to credentials/gmail_token.json")
                    return
        except httpx.ConnectError:
            typer.echo(f"\r⏳ Waiting for {base} to become reachable...", nl=False)
        except Exception:
            pass

        dots = (dots + 1) % 4
        typer.echo(f"\r⏳ Waiting{' .' * dots}   ", nl=False)
        time.sleep(poll_interval)


# ─────────────────────────────────────────────
# Setup command
# ─────────────────────────────────────────────

@app.command()
def setup() -> None:
    """Ensure AI/* labels exist in Gmail and validate configuration."""
    if API_URL:
        typer.echo(f"📡 Calling {API_URL}/api/setup ...")
        result = _call_api("/api/setup")
        typer.echo(f"✅ Labels created: {len(result.get('labels', {}))}")
        return

    # Local execution
    from src.gmail.labels import ensure_labels_exist
    from src.config import settings

    typer.echo("EmailBot Setup")
    typer.echo("=" * 40)
    typer.echo(f"Gmail accounts: {settings.gmail_account_list}")
    typer.echo(f"DeepSeek model: {settings.deepseek_model}")
    typer.echo("")

    typer.echo("Checking Gmail labels...")
    labels = ensure_labels_exist()
    for cat, lid in labels.items():
        typer.echo(f"  ✓ {cat} → {lid}")

    typer.echo("")
    typer.echo("Setup complete. Run 'emailbot poll' to start classifying.")


# ─────────────────────────────────────────────
# Poll command
# ─────────────────────────────────────────────

@app.command()
def poll(
    continuous: bool = typer.Option(
        True, "--continuous/--once", help="Run continuously or just once"
    ),
) -> None:
    """Poll Gmail for new unlabeled emails and classify them."""
    if API_URL:
        if continuous:
            typer.echo(f"📡 Starting continuous poll via {API_URL}...")
            typer.echo("   Press Ctrl+C to stop.")
            try:
                while True:
                    result = _call_api("/api/poll")
                    count = result.get("processed", 0)
                    if count:
                        typer.echo(f"   Processed {count} emails")
                    time.sleep(60)
            except KeyboardInterrupt:
                typer.echo("\n⏹  Poll stopped.")
        else:
            typer.echo(f"📡 Calling {API_URL}/api/poll ...")
            result = _call_api("/api/poll")
            typer.echo(f"✅ Processed {result.get('processed', 0)} emails")
        return

    # Local execution
    from src.scheduler.poller import run_poller

    if continuous:
        typer.echo("Starting continuous poll. Press Ctrl+C to stop.")
        run_poller()
    else:
        from src.scheduler.poller import poll_once
        count = poll_once()
        typer.echo(f"Processed {count} emails.")


# ─────────────────────────────────────────────
# Cleanup command
# ─────────────────────────────────────────────

@app.command()
def cleanup() -> None:
    """Batch process ALL historical unlabeled emails."""
    if API_URL:
        typer.echo(f"📡 Calling {API_URL}/api/cleanup ...")
        typer.echo("   This may take a while...")
        result = _call_api("/api/cleanup")
        typer.echo(f"✅ Processed {result.get('processed', 0)} emails")
        return

    # Local execution
    from src.scheduler.cleanupper import run_cleanup

    typer.echo("Starting historical cleanup...")
    total = run_cleanup()
    typer.echo(f"Done. Processed {total} emails.")


# ─────────────────────────────────────────────
# Spam-delete command
# ─────────────────────────────────────────────

@app.command()
def spam_delete() -> None:
    """Delete spam emails older than configured threshold."""
    if API_URL:
        typer.echo(f"📡 Calling {API_URL}/api/spam-delete ...")
        result = _call_api("/api/spam-delete")
        typer.echo(f"✅ Deleted {result.get('deleted', 0)} spam emails")
        return

    # Local execution
    from src.scheduler.spam_deleter import run_spam_delete
    from src.config import settings

    typer.echo(f"Deleting spam older than {settings.spam_older_than_days} days...")
    total = run_spam_delete()
    typer.echo(f"Done. Deleted {total} spam emails.")


# ─────────────────────────────────────────────
# Stats command
# ─────────────────────────────────────────────

@app.command()
def stats() -> None:
    """Show processing statistics."""
    if API_URL:
        typer.echo(f"📡 Calling {API_URL}/api/stats ...")
        result = _call_api("/api/stats")
        typer.echo(f"   Processed today: {result.get('processed_today', 0)}")
        typer.echo(f"   Processed this week: {result.get('processed_week', 0)}")
        typer.echo(f"   Last poll: {result.get('last_poll', 'never')}")
        return

    # Local execution
    from src.persistence.tracker import get_processed_count, get_last_poll_time

    typer.echo("EmailBot Statistics")
    typer.echo("=" * 40)
    typer.echo(f"   Processed today: {get_processed_count(days=1)}")
    typer.echo(f"   Processed this week: {get_processed_count(days=7)}")
    last = get_last_poll_time()
    typer.echo(f"   Last poll: {last or 'never'}")


if __name__ == "__main__":
    app()
