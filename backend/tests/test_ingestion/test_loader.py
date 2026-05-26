"""Tests for the rankings loader's external-ID matching and player dedup."""
import pytest

from rankings_ingester.dedup import normalize_name
from rankings_ingester.loader import upsert_player
from app.models.player import Player


class TestNormalizeName:
    def test_strips_suffixes(self):
        assert normalize_name("James Cook III") == "james cook"
        assert normalize_name("Marvin Harrison Jr.") == "marvin harrison"
        assert normalize_name("Odell Beckham Jr") == "odell beckham"
        assert normalize_name("Ken Griffey Sr") == "ken griffey"

    def test_strips_punctuation(self):
        assert normalize_name("D.J. Moore") == "dj moore"
        assert normalize_name("Ja'Marr Chase") == "jamarr chase"
        assert normalize_name("De'Von Achane") == "devon achane"

    def test_empty_and_whitespace(self):
        assert normalize_name("") == ""
        assert normalize_name("   ") == ""

    def test_suffix_must_be_token_not_substring(self):
        # "Jr" suffix gets stripped, but a name containing "ii" as a syllable shouldn't
        assert normalize_name("Patrick Mahomes II") == "patrick mahomes"
        assert normalize_name("Ronnie Hickman") == "ronnie hickman"  # not "ronn hckman"

    def test_collapses_whitespace(self):
        assert normalize_name("James   Cook  III") == "james cook"


class TestUpsertPlayerExternalIdMatching:
    async def test_match_by_espn_id_wins_over_name(self, db_session):
        """If two players exist — one with espn_id, one with same name+pos but no
        external IDs — an ingest entry carrying espn_id should match the ID one."""
        canonical = Player(
            full_name="James Cook III", position="RB", nfl_team="BUF", espn_id=4361259
        )
        orphan = Player(full_name="James Cook", position="RB", nfl_team="BUF")
        db_session.add_all([canonical, orphan])
        await db_session.flush()

        # Ingest entry uses the espn_id — should match canonical, not orphan
        entry = {
            "full_name": "James Cook",  # legacy short name in the source
            "position": "RB",
            "nfl_team": "BUF",
            "bye_week": 0,
            "espn_id": 4361259,
        }
        player, is_new = await upsert_player(db_session, entry)

        assert is_new is False
        assert player.id == canonical.id
        assert player.full_name == "James Cook III"  # canonical's name wins

    async def test_falls_back_to_name_when_no_external_id_on_entry(self, db_session):
        existing = Player(full_name="Test Player", position="WR", nfl_team="DAL")
        db_session.add(existing)
        await db_session.flush()

        entry = {
            "full_name": "Test Player",
            "position": "WR",
            "nfl_team": "DAL",
            "bye_week": 0,
        }
        player, is_new = await upsert_player(db_session, entry)
        assert is_new is False
        assert player.id == existing.id

    async def test_heals_missing_external_id_on_name_match(self, db_session):
        """If we match an existing row by name and the entry carries an espn_id
        the row was missing, we backfill the ID. Next ingest matches by ID."""
        existing = Player(full_name="Healable Player", position="QB", nfl_team="KC")
        db_session.add(existing)
        await db_session.flush()
        assert existing.espn_id is None

        entry = {
            "full_name": "Healable Player",
            "position": "QB",
            "nfl_team": "KC",
            "bye_week": 0,
            "espn_id": 99999,
        }
        player, is_new = await upsert_player(db_session, entry)
        assert is_new is False
        assert player.espn_id == 99999

    async def test_creates_new_player_with_external_id(self, db_session):
        entry = {
            "full_name": "Brand New",
            "position": "TE",
            "nfl_team": "SF",
            "bye_week": 9,
            "espn_id": 12345,
        }
        player, is_new = await upsert_player(db_session, entry)
        assert is_new is True
        assert player.full_name == "Brand New"
        assert player.espn_id == 12345
        assert player.bye_week == 9
