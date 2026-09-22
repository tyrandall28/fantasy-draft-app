import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class DraftPick(Base):
    __tablename__ = "draft_picks"

    # The draft room reads the taken players, checks the one being picked
    # against that list, and inserts — with awaits in between, and with the
    # auto-pick timer firing on the same event loop. A human pick landing as
    # the clock expires could put the same player on two rosters, or two rows
    # at the same slot. Nothing in the schema said no, so the database is
    # where that gets settled.
    __table_args__ = (
        UniqueConstraint("league_id", "player_id", name="uq_draft_picks_league_player"),
        UniqueConstraint("league_id", "overall_pick", name="uq_draft_picks_league_slot"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    league_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("leagues.id"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    player_id: Mapped[int] = mapped_column(Integer, ForeignKey("players.id"), nullable=False)
    round_num: Mapped[int] = mapped_column(Integer, nullable=False)
    pick_in_round: Mapped[int] = mapped_column(Integer, nullable=False)
    overall_pick: Mapped[int] = mapped_column(Integer, nullable=False)
    is_auto: Mapped[bool] = mapped_column(Boolean, default=False)
    picked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    player: Mapped["Player"] = relationship(lazy="joined")


from app.models.player import Player  # noqa: E402
