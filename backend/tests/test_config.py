"""Tests for the production safety guard on settings.

The dev defaults for `secret_key` and `database_url` are published in a public
repo, so a production deploy that forgets to override them would sign JWTs with
a value anyone can read off GitHub. The guard turns that into a startup crash.

Values are passed as explicit kwargs (highest precedence in pydantic-settings)
so these don't depend on whatever env vars the developer happens to have set.
"""
import pytest
from pydantic import ValidationError

from app.config import DEV_DATABASE_URL, DEV_SECRET_KEY, Settings

REAL_SECRET = "P9xq2Lm8vTz4Kw7RcNb1FjHs6YdA3Qe5"
REAL_DB_URL = "postgresql+asyncpg://user:pw@10.0.0.5:5432/fantasy_draft"


def _settings(**overrides) -> Settings:
    base = {"secret_key": DEV_SECRET_KEY, "database_url": DEV_DATABASE_URL}
    return Settings(**{**base, **overrides})


class TestDevelopmentDefaults:
    def test_defaults_are_fine_in_development(self):
        s = _settings(environment="development")
        assert s.is_production is False
        assert s.secret_key == DEV_SECRET_KEY

    def test_environment_defaults_to_development(self):
        assert Settings().is_production is False


class TestProductionGuard:
    @pytest.mark.parametrize("env", ["production", "prod", "staging", "PRODUCTION", " Production "])
    def test_rejects_dev_defaults(self, env):
        with pytest.raises(ValidationError) as exc:
            _settings(environment=env)
        assert "APP_SECRET_KEY" in str(exc.value)
        assert "APP_DATABASE_URL" in str(exc.value)

    def test_names_only_the_offending_setting(self):
        """A deploy that set the DB URL but forgot the key should be told exactly that."""
        with pytest.raises(ValidationError) as exc:
            _settings(environment="production", database_url=REAL_DB_URL)
        message = str(exc.value)
        assert "APP_SECRET_KEY" in message
        assert "APP_DATABASE_URL" not in message

    def test_rejects_default_db_url_alone(self):
        with pytest.raises(ValidationError) as exc:
            _settings(environment="production", secret_key=REAL_SECRET)
        message = str(exc.value)
        assert "APP_DATABASE_URL" in message
        assert "APP_SECRET_KEY" not in message

    def test_accepts_real_values(self):
        s = _settings(
            environment="production", secret_key=REAL_SECRET, database_url=REAL_DB_URL
        )
        assert s.is_production is True
        assert s.secret_key == REAL_SECRET

    def test_error_explains_how_to_generate_a_key(self):
        with pytest.raises(ValidationError) as exc:
            _settings(environment="production")
        assert "secrets.token_urlsafe" in str(exc.value)

    @pytest.mark.parametrize("env", ["development", "dev", "test", "local", ""])
    def test_non_production_environments_are_unaffected(self, env):
        assert _settings(environment=env).is_production is False
