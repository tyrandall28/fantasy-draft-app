import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.user import User

ALGORITHM = "HS256"

# bcrypt only ever hashes the first 72 bytes of a password. Older versions
# silently truncated anything longer; bcrypt 5.0 raises instead. We truncate
# explicitly, which is also what passlib did, so hashes created before this
# module stopped using passlib still verify.
_BCRYPT_MAX_BYTES = 72


def _to_bcrypt_input(password: str) -> bytes:
    return password.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """Hash a password with bcrypt, returning the standard `$2b$` string.

    Uses the `bcrypt` package directly rather than passlib: passlib 1.7.4 is
    unmaintained and detects its backend via `bcrypt.__about__.__version__`,
    which bcrypt removed in 4.1. On bcrypt 5.x that detection fails and every
    hash/verify call raises, so a fresh install had completely broken auth
    while a pinned-old local environment looked fine.
    """
    return bcrypt.hashpw(_to_bcrypt_input(password), bcrypt.gensalt()).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(_to_bcrypt_input(plain), hashed.encode("ascii"))
    except (ValueError, TypeError):
        # Malformed or non-bcrypt stored hash — treat as a failed login rather
        # than a 500.
        return False


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "access"},
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def create_refresh_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "refresh"},
        settings.secret_key,
        algorithm=ALGORITHM,
    )


def decode_token(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        return None


async def get_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def get_user_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


async def register_user(db: AsyncSession, email: str, username: str, password: str) -> User:
    user = User(
        email=email,
        username=username,
        hashed_password=hash_password(password),
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
