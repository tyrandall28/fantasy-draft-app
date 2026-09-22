import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError

from app.api.deps import DB, CurrentUser
from app.schemas.auth import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from app.services.auth_service import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_user_by_email,
    get_user_by_id,
    get_user_by_username,
    register_user,
    verify_password,
)
from app.services.rate_limit import limit_login, limit_refresh, limit_register

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(limit_register)],
)
async def register(body: RegisterRequest, db: DB):
    if await get_user_by_email(db, body.email):
        raise HTTPException(status_code=400, detail="Email already registered")

    # `username` is UNIQUE in the database too, and only the email was checked
    # here — so the second person to want a username got an IntegrityError and
    # a 500 on the one screen every visitor sees first.
    if await get_user_by_username(db, body.username):
        raise HTTPException(status_code=400, detail="Username already taken")

    try:
        user = await register_user(db, body.email, body.username, body.password)
    except IntegrityError:
        # Both checks above can still lose a race with a simultaneous signup.
        # The database has the last word; this turns its answer into the same
        # 400 rather than a 500.
        await db.rollback()
        raise HTTPException(status_code=400, detail="Email or username already taken")

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/login", response_model=TokenResponse, dependencies=[Depends(limit_login)])
async def login(body: LoginRequest, db: DB):
    user = await get_user_by_email(db, body.email)
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/refresh", response_model=TokenResponse, dependencies=[Depends(limit_refresh)])
async def refresh(body: RefreshRequest, db: DB):
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    user = await get_user_by_id(db, uuid.UUID(payload["sub"]))
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


@router.get("/me", response_model=UserResponse)
async def me(user: CurrentUser):
    return user
