"""
Gmail OAuth2 authentication.

Handles OAuth2 token acquisition and refresh using the Google Auth library.
The token is persisted to a local JSON file so the user only needs to
authenticate through the browser once.
"""

import json
import logging
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow

from src.config import settings

logger = logging.getLogger(__name__)

# Gmail API scopes required by this application
SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",  # Read, send, delete, manage labels
    "https://www.googleapis.com/auth/gmail.labels",   # Create/update labels
]


def get_credentials() -> Credentials:
    """
    Obtain valid Gmail API credentials, refreshing or re-authenticating as needed.

    Checks for an existing token file. If found and valid (including refresh),
    returns it. If expired but refreshable, refreshes automatically. If missing
    or unrefreshable, launches the browser OAuth flow.

    Returns:
        Valid Google OAuth2 Credentials object.

    Raises:
        FileNotFoundError: If no client secret JSON is found in credentials/.
    """
    token_path = settings.gmail_token_path
    creds: Credentials | None = None

    # Load existing token if present
    if token_path and token_path.exists():
        try:
            creds = Credentials.from_authorized_user_file(
                str(token_path), SCOPES
            )
            logger.info("Loaded existing Gmail credentials from %s", token_path)
        except (ValueError, json.JSONDecodeError) as exc:
            logger.warning("Could not parse token file: %s — will re-authenticate", exc)
            creds = None

    # Refresh or re-authenticate
    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        logger.info("Refreshing expired Gmail credentials...")
        creds.refresh(Request())
        _save_credentials(creds, token_path)
        return creds

    # Need full OAuth flow — find client secret
    client_secret = _find_client_secret()
    if client_secret is None:
        raise FileNotFoundError(
            "No Google OAuth client secret found. Download one from "
            "https://console.cloud.google.com/apis/credentials and save it as "
            "credentials/client_secret.json or credentials/gmail_oauth.json"
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secret), SCOPES)
    creds = flow.run_local_server(port=0)
    _save_credentials(creds, token_path)
    logger.info("OAuth flow completed — token saved to %s", token_path)
    return creds


def _save_credentials(creds: Credentials, path: Path) -> None:
    """Persist credentials to the token file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w") as f:
        f.write(creds.to_json())
    path.chmod(0o600)


def _find_client_secret() -> Path | None:
    """Locate the Google OAuth client secret JSON file."""
    candidates = [
        Path("/data/client_secret.json"),  # Fly.io persistent volume
        Path("/data/gmail_oauth.json"),
        settings.credentials_dir / "client_secret.json",
        settings.credentials_dir / "gmail_oauth.json",
        Path("credentials/client_secret.json"),
        Path("credentials/gmail_oauth.json"),
    ]
    for candidate in candidates:
        if candidate.exists():
            logger.info("Found client secret at %s", candidate)
            return candidate
    return None
