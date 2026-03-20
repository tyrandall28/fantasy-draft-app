import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class UserRanking(Base):
    __tablename__ = "user_rankings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    entries: Mapped[list["UserRankingEntry"]] = relationship(
        back_populates="ranking", cascade="all, delete-orphan", order_by="UserRankingEntry.rank"
    )


class UserRankingEntry(Base):
    __tablename__ = "user_ranking_entries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ranking_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("user_rankings.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), nullable=False)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, default=False)

    ranking: Mapped["UserRanking"] = relationship(back_populates="entries")
    player: Mapped["Player"] = relationship(lazy="joined")


from app.models.player import Player  # noqa: E402
