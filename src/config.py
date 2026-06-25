"""
Application configuration loaded from environment variables.

Uses pydantic-settings to load from .env file and provide typed access
to all configuration values needed by the email classification pipeline.
"""

from pathlib import Path
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Typed configuration loaded from .env file."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ─── DeepSeek API ───
    deepseek_model: str = "deepseek-chat"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_temperature: float = 0.0
    deepseek_max_tokens: int = 50

    # ─── Gmail ───
    gmail_accounts: str = ""
    gmail_credential_names: str = ""
    gmail_poll_interval_minutes: int = 1
    gmail_rate_limit_qps: int = 250

    # ─── Classification ───
    pre_classifier_enabled: bool = True
    default_fallback_category: str = "fyi"
    skip_ai_if_labeled: bool = True

    # ─── Spam Deletion ───
    spam_delete_schedule_cron: str = "0 8 * * *"
    spam_delete_batch_size: int = 50
    spam_older_than_days: int = 1

    # ─── Retry ───
    max_retries: int = 3
    retry_delay_ms: int = 2000

    # ─── N8N (kept for reference, not used by new app) ───
    n8n_base_url: str = "http://localhost:5678"
    wf0_secret_token: str = ""

    # ─── Paths ───
    credentials_dir: Path = Path("credentials")
    gmail_token_path: Optional[Path] = None

    def model_post_init(self, _context) -> None:
        """Set derived paths after model initialisation."""
        if self.gmail_token_path is None:
            # Prefer /data/ on Fly.io, fall back to local credentials/
            fly_token = Path("/data/gmail_token.json")
            if fly_token.exists():
                self.gmail_token_path = fly_token
            else:
                self.gmail_token_path = self.credentials_dir / "gmail_token.json"

    @property
    def gmail_account_list(self) -> list[str]:
        """Parse comma-separated Gmail accounts into a list."""
        if not self.gmail_accounts.strip():
            return []
        return [a.strip() for a in self.gmail_accounts.split(",") if a.strip()]

    @property
    def gmail_credential_name_list(self) -> list[str]:
        """Parse comma-separated Gmail credential names into a list."""
        if not self.gmail_credential_names.strip():
            return []
        return [c.strip() for c in self.gmail_credential_names.split(",") if c.strip()]


# Singleton instance
settings = Settings()
