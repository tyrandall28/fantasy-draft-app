from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://fantasy:fantasy_dev@localhost:5432/fantasy_draft"
    secret_key: str = "dev-secret-change-in-production"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    cors_origins: list[str] = ["http://localhost:5173"]

    # AI assistant (natural-language DB query feature)
    anthropic_api_key: str = ""
    assistant_model: str = "claude-opus-5"

    # Loads from real environment variables first, then backend/.env (gitignored).
    # All keys take the APP_ prefix, e.g. APP_ANTHROPIC_API_KEY.
    model_config = {"env_prefix": "APP_", "env_file": ".env", "extra": "ignore"}


settings = Settings()
