import re
import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

# Registration had no validation of any kind: `email: str` (while EmailStr sat
# imported and unused) and a bare `password: str`, so "x" / "x" was a valid
# account. These bounds are the minimum worth deploying with.

MIN_PASSWORD_LENGTH = 8

# bcrypt hashes only the first 72 *bytes* and auth_service truncates to match.
# Past that, extra characters are silently meaningless — so rather than accept
# a 200-character password and quietly ignore most of it, cap the field. The
# limit is in characters and multibyte characters cost more than one byte, so
# this is deliberately below 72 and still far beyond any real password.
MAX_PASSWORD_LENGTH = 64

# Structural, not authoritative: one @, something before it, a dotted domain
# after it, no whitespace. Deliberately not an attempt at RFC 5322 — the only
# real proof an address exists is sending mail to it (TODO.md, "Email
# verification on register"). This just stops "asdf" becoming an account.
_EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s.]+$")


class RegisterRequest(BaseModel):
    email: str = Field(..., max_length=254)  # RFC 5321 limit on a full address
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def _check_email_shape(cls, v: str) -> str:
        v = v.strip()
        if not _EMAIL_SHAPE.match(v):
            raise ValueError("Enter a valid email address.")
        # Stored lowercase so Bob@x.com and bob@x.com can't become two accounts
        # — get_user_by_email does an exact match.
        return v.lower()

    @field_validator("username")
    @classmethod
    def _check_username(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters.")
        return v

    @field_validator("password")
    @classmethod
    def _check_password_strength(cls, v: str) -> str:
        """Length, plus one letter and one digit.

        Kept light on purpose. Long composition rules ("one symbol, one
        capital") push people toward Password1! and NIST SP 800-63B now
        recommends against mandating them; length is what actually helps. The
        letter-and-digit floor is here because it rules out "12345678" and
        "aaaaaaaa" cheaply, which a length rule alone does not.
        """
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
        if not re.search(r"[A-Za-z]", v) or not re.search(r"\d", v):
            raise ValueError("Password must contain at least one letter and one number.")
        return v


class LoginRequest(BaseModel):
    # No validation rules here on purpose. Login must accept whatever is typed
    # and fail on the credential check — rejecting a "too short" password at
    # the schema tells an attacker the rules and locks out anyone who
    # registered before them.
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return v.strip().lower()


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    username: str
    created_at: datetime

    model_config = {"from_attributes": True}
