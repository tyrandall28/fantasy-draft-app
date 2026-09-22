from pydantic import Field, model_validator
from pydantic_settings import BaseSettings

# These defaults exist so `git clone` -> run works with no setup, and they are
# published in a public repo. That's fine for localhost and fatal in production:
# a deploy that forgets APP_SECRET_KEY would sign JWTs with a value anyone can
# read off GitHub, letting them forge a token for any user. The validator below
# refuses to start in production while either is still at its default.
DEV_SECRET_KEY = "dev-secret-change-in-production"
DEV_DATABASE_URL = "postgresql+asyncpg://fantasy:fantasy_dev@localhost:5432/fantasy_draft"

PRODUCTION_ENVIRONMENTS = {"production", "prod", "staging"}


class Settings(BaseSettings):
    # Set APP_ENVIRONMENT=production on any deployed instance. It only gates the
    # safety check below — nothing branches on it behaviourally.
    environment: str = "development"

    database_url: str = DEV_DATABASE_URL
    secret_key: str = DEV_SECRET_KEY
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7
    cors_origins: list[str] = ["http://localhost:5173"]

    # AI assistant (natural-language DB query feature)
    anthropic_api_key: str = ""
    assistant_model: str = "claude-opus-5"

    # Off in the deployed app on purpose: every question costs real Anthropic
    # credits, and there's no per-user quota or rate limit in front of the
    # endpoint yet, so an open deploy is an open tab on someone else's bill.
    # Two independent conditions have to hold for the assistant to answer (see
    # the `assistant_enabled` property) — an unset key alone used to be the
    # only guard, and "we forgot to set a variable" is not a decision. Local
    # dev has a key in backend/.env and this defaults to True, so nothing
    # changes there. `validation_alias` keeps the env var as the name you'd
    # guess, APP_ASSISTANT_ENABLED, rather than the field's own longer name.
    assistant_enabled_flag: bool = Field(True, validation_alias="APP_ASSISTANT_ENABLED")

    # Loads from real environment variables first, then backend/.env (gitignored).
    # All keys take the APP_ prefix, e.g. APP_ANTHROPIC_API_KEY.
    model_config = {"env_prefix": "APP_", "env_file": ".env", "extra": "ignore"}

    @property
    def is_production(self) -> bool:
        return self.environment.strip().lower() in PRODUCTION_ENVIRONMENTS

    @property
    def assistant_enabled(self) -> bool:
        """Whether the assistant can actually answer a question.

        Needs the feature flag *and* a key: the flag is the intent, the key is
        the capability, and neither implies the other. The frontend reads this
        from /api/assistant/status and renders a "coming soon" page when it's
        false, rather than letting someone type a question and collecting an
        error for their trouble.
        """
        return self.assistant_enabled_flag and bool(self.anthropic_api_key.strip())

    @model_validator(mode="after")
    def _reject_dev_defaults_in_production(self) -> "Settings":
        """Fail fast rather than serving forgeable tokens.

        Deliberately a startup crash, not a warning: a warning in a log nobody
        reads is how an insecure deploy stays up for months.
        """
        if not self.is_production:
            return self

        unset = []
        if self.secret_key == DEV_SECRET_KEY:
            unset.append("APP_SECRET_KEY")
        if self.database_url == DEV_DATABASE_URL:
            unset.append("APP_DATABASE_URL")
        if unset:
            raise ValueError(
                f"APP_ENVIRONMENT={self.environment!r} but these are still at their "
                f"public development defaults: {', '.join(unset)}. Set them to real "
                "values. Generate a secret key with: "
                'python -c "import secrets; print(secrets.token_urlsafe(64))"'
            )
        return self


settings = Settings()
