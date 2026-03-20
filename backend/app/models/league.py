import secrets
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


def generate_invite_code() -> str:
    return secrets.token_urlsafe(9)[:12]


class League(Base):
    __tablename__ = "leagues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    invite_code: Mapped[str] = mapped_column(String(12), unique=True, nullable=False, default=generate_invite_code)
    commissioner_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    team_count: Mapped[int] = mapped_column(Integer, default=10)
    roster_size: Mapped[int] = mapped_column(Integer, default=15)
    bench_size: Mapped[int] = mapped_column(Integer, default=6)
    position_slots: Mapped[dict] = mapped_column(JSONB, default=lambda: {"QB": 1, "RB": 2, "WR": 2, "TE": 1, "FLEX": 1, "K": 1, "DST": 1, "BN": 6})
    pick_time_seconds: Mapped[int] = mapped_column(Integer, default=90)
    scoring_type: Mapped[str] = mapped_column(String(20), default="ppr")
    draft_order: Mapped[list | None] = mapped_column(JSONB, nullable=True)
    bot_ranking_source: Mapped[str] = mapped_column(String(50), default="espn_ppr", server_default="espn_ppr")
    status: Mapped[str] = mapped_column(String(20), default="setup")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    members: Mapped[list["LeagueMember"]] = relationship(back_populates="league", cascade="all, delete-orphan")


class LeagueMember(Base):
    __tablename__ = "league_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    league_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    team_name: Mapped[str] = mapped_column(String(50), default="My Team")
    draft_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ranking_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("user_rankings.id"), nullable=True)
    is_bot: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    league: Mapped["League"] = relationship(back_populates="members")
