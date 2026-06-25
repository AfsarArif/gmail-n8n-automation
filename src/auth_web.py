"""
Web-based OAuth authentication helpers.

Handles Google OAuth2 flow for deployed environments where we have a
fixed redirect URI (e.g., https://emailbot.fly.dev/callback).

PKCE is handled by persisting the code_verifier to a file keyed by the
OAuth state parameter, so the /login and /callback routes (separate
HTTP requests) can share the same verifier.

The flow:
1. User visits /login → Flow created, code_verifier saved, redirected to Google
2. Google redirects to /callback with ?code=...&state=...
3. Server loads code_verifier by state, exchanges code for credentials, saves token
"""

import json
import logging
import pickle
from pathlib import Path

from google_auth_oauthlib.flow import Flow

from src.config import settings

logger = logging.getLogger(__name__)

# Gmail API scopes
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.labels",
]

# Paths
CLIENT_SECRET_PATH = Path("/data/client_secret.json")
TOKEN_PATH = Path("/data/gmail_token.json")
OAUTH_STATE_DIR = Path("/data/oauth_states")


def _find_client_secret() -> Path:
    """Find the client secret JSON file (server or local fallback)."""
    if CLIENT_SECRET_PATH.exists():
        return CLIENT_SECRET_PATH
    local = settings.credentials_dir / "client_secret.json"
    if local.exists():
        return local
    raise FileNotFoundError(
        "No Google OAuth client secret found. "
        "Upload it via: fly ssh console -C 'tee /data/client_secret.json' < credentials/client_secret.json"
    )


def _get_redirect_uri() -> str | None:
    """Get redirect URI from environment, if set."""
    import os
    return os.environ.get("EMAILBOT_REDIRECT_URI")


def _build_flow(redirect_uri: str | None = None, code_verifier: str | None = None) -> Flow:
    """Build a Flow instance, optionally restoring a saved code_verifier."""
    redirect_uri = redirect_uri or _get_redirect_uri()
    if not redirect_uri:
        raise ValueError("EMAILBOT_REDIRECT_URI environment variable must be set")

    client_secret = _find_client_secret()
    flow = Flow.from_client_secrets_file(
        str(client_secret),
        scopes=SCOPES,
        redirect_uri=redirect_uri,
        code_verifier=code_verifier,
    )
    return flow


def _save_flow_state(state: str, flow: Flow) -> None:
    """Persist the Flow's PKCE code_verifier to disk, keyed by OAuth state."""
    OAUTH_STATE_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "code_verifier": flow.code_verifier,
        "redirect_uri": flow.redirect_uri,
    }
    state_file = OAUTH_STATE_DIR / f"{state}.json"
    state_file.write_text(json.dumps(data))
    state_file.chmod(0o600)
    logger.info("Saved OAuth state %s to disk", state)


def _load_flow_state(state: str) -> dict | None:
    """Load a previously-saved Flow PKCE state, or None if not found."""
    state_file = OAUTH_STATE_DIR / f"{state}.json"
    if not state_file.exists():
        logger.warning("OAuth state %s not found on disk", state)
        return None
    try:
        return json.loads(state_file.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("Failed to load OAuth state %s: %s", state, exc)
        return None


def _cleanup_state(state: str) -> None:
    """Remove a saved OAuth state file after use."""
    state_file = OAUTH_STATE_DIR / f"{state}.json"
    if state_file.exists():
        state_file.unlink()
        logger.debug("Cleaned up OAuth state %s", state)


def get_authorization_url(redirect_uri: str | None = None) -> tuple[str, str]:
    """
    Generate the Google OAuth authorization URL and persist PKCE state.

    Returns:
        Tuple of (authorization_url, oauth_state).
        The oauth_state is needed by exchange_code() to load the PKCE verifier.
    """
    flow = _build_flow(redirect_uri)
    auth_url, state = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )
    _save_flow_state(state, flow)
    logger.info("Generated authorization URL (state=%s)", state)
    return auth_url, state


def exchange_code(code: str, oauth_state: str, redirect_uri: str | None = None) -> dict:
    """
    Exchange an OAuth authorization code for credentials.

    Loads the PKCE code_verifier saved during get_authorization_url(),
    exchanges the code, and saves the resulting token to disk.

    Args:
        code: The authorization code from Google's redirect.
        oauth_state: The state parameter from Google's redirect callback.
        redirect_uri: Must match the redirect_uri used in get_authorization_url().

    Returns:
        Dict with status and a display label on success.
    """
    saved = _load_flow_state(oauth_state)
    if saved is None:
        raise ValueError(
            "OAuth state not found — the login session may have expired. "
            "Please start the authentication again at /login"
        )

    code_verifier = saved["code_verifier"]
    redirect_uri = redirect_uri or saved.get("redirect_uri") or _get_redirect_uri()

    flow = _build_flow(redirect_uri=redirect_uri, code_verifier=code_verifier)
    flow.fetch_token(code=code)
    creds = flow.credentials

    # Clean up the state file now that we're done
    _cleanup_state(oauth_state)

    # Save token to persistent volume
    TOKEN_PATH.parent.mkdir(parents=True, exist_ok=True)
    token_data = creds.to_json()
    TOKEN_PATH.write_text(token_data)
    TOKEN_PATH.chmod(0o600)

    # Also save local copy if possible (for CLI use)
    local_token = settings.gmail_token_path
    if local_token:
        local_token.parent.mkdir(parents=True, exist_ok=True)
        local_token.write_text(token_data)
        local_token.chmod(0o600)
        logger.info("Token saved to %s and %s", TOKEN_PATH, local_token)
    else:
        logger.info("Token saved to %s", TOKEN_PATH)

    return {"status": "authenticated", "email": "gmail"}


def token_exists() -> bool:
    """Check if a valid token already exists."""
    if not TOKEN_PATH.exists():
        return False
    try:
        data = json.loads(TOKEN_PATH.read_text())
        return bool(data.get("refresh_token") or data.get("token"))
    except (json.JSONDecodeError, OSError):
        return False
