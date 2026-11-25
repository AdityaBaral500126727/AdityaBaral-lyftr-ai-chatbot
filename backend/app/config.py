import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    LLM_API_KEYS: str = ""
    DATABASE_URL: str = "sqlite:///./app.db"
    ALLOWED_ORIGINS: str = "*"
    ENABLE_FAILURE_SIMULATION: bool = True
    PRIMARY_MODEL: str = "gemini/gemini-3.5-flash-lite"
    FALLBACK_MODEL: str = "groq/openai/gpt-oss-20b"
    LLM_TIMEOUT: float = 35.0
    DEFAULT_SYSTEM_PROMPT: str = (
        "You are Lyftr AI, a helpful and structured assistant. "
        "Format your responses using clean GitHub Flavored Markdown (GFM). "
        "Whenever appropriate for comparisons, multi-attribute concepts, key features, "
        "or structured specifications, include well-formatted Markdown tables, "
        "distinct headers, and bold bullet points for maximum clarity."
    )

    @property
    def key_pool(self) -> List[str]:
        """Returns the list of clean, non-empty API keys in priority order."""
        if not self.LLM_API_KEYS:
            return []
        return [k.strip() for k in self.LLM_API_KEYS.split(",") if k.strip()]

    @property
    def cors_origins(self) -> List[str]:
        """Returns list of allowed CORS origins."""
        if not self.ALLOWED_ORIGINS or self.ALLOWED_ORIGINS.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]

    @property
    def sqlite_db_path(self) -> str:
        """Parses DATABASE_URL to a filesystem path suitable for sqlite3."""
        url = self.DATABASE_URL
        if url.startswith("sqlite:///"):
            clean_path = url[len("sqlite:///"):]
            # On Unix, sqlite:////data/app.db becomes /data/app.db
            if url.startswith("sqlite:////"):
                clean_path = "/" + url[len("sqlite:////"):]
            return clean_path
        return url


settings = Settings()

