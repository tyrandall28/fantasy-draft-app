"""Tests for the analytics endpoints, focused on partially-played seasons.

The 2026 season starting exposed a whole class of bug: `min_games` defaults to 3,
but in week 1 every player has exactly one game, so every consumer of derived
stats returned nothing while the data was fully loaded. These pin the fix.

Refreshing the data mid-week is the second half of the same bug. Thursday night
gives two teams a week-2 row, `max(week)` becomes 2, and a floor clamped to it
hides every player whose team hasn't kicked off. The floor is clamped to the
least-played team's games instead -- see app.services.season_coverage.
"""
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.player import Player, PlayerDerivedStats, PlayerWeeklyStat


async def _make_player(
    db: AsyncSession, name: str, position: str = "WR", team: str = "DAL"
) -> Player:
    player = Player(full_name=name, position=position, nfl_team=team)
    db.add(player)
    await db.flush()
    return player


async def _add_season(
    db: AsyncSession,
    player: Player,
    season: int,
    *,
    weeks: int,
    ppr_per_game: float,
    position: str = "WR",
    team: str | None = None,
) -> None:
    """Give a player `weeks` game logs plus the matching derived-stats row.

    `team` stamps the weekly rows, which is what season coverage groups by. Pass
    it whenever a test needs teams to be at different points in the season.
    """
    for week in range(1, weeks + 1):
        db.add(
            PlayerWeeklyStat(
                player_id=player.id,
                season=season,
                week=week,
                team=team,
                fantasy_points_ppr=ppr_per_game,
            )
        )
    db.add(
        PlayerDerivedStats(
            player_id=player.id,
            season=season,
            position=position,
            games_played=weeks,
            ppr_per_game=ppr_per_game,
        )
    )
    await db.flush()


class TestPositionRankingsPartialSeason:
    async def test_week_one_season_is_not_filtered_to_nothing(
        self, client, auth_headers, db_session
    ):
        """The bug: min_games=3 against a 1-week season returned zero rows."""
        player = await _make_player(db_session, "Week One Wonder")
        await _add_season(db_session, player, 2026, weeks=1, ppr_per_game=33.8)
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2026, "min_games": 3},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert rows[0]["full_name"] == "Week One Wonder"
        assert rows[0]["games_played"] == 1

    async def test_complete_season_still_honours_min_games(
        self, client, auth_headers, db_session
    ):
        """Clamping must not weaken the filter on a full season."""
        regular = await _make_player(db_session, "Full Season Guy")
        await _add_season(db_session, regular, 2025, weeks=17, ppr_per_game=19.0)
        # A one-game cameo in the same, fully-played season should be excluded.
        cameo = await _make_player(db_session, "One Game Cameo")
        await _add_season(db_session, cameo, 2025, weeks=1, ppr_per_game=40.0)
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2025, "min_games": 3},
            headers=auth_headers,
        )
        names = [r["full_name"] for r in resp.json()]
        assert names == ["Full Season Guy"]

    async def test_clamp_is_a_ceiling_not_a_free_pass(
        self, client, auth_headers, db_session
    ):
        """The clamp is a ceiling on the floor, so once the season is long
        enough an injured player is still filtered out normally."""
        healthy = await _make_player(db_session, "Played Every Week")
        await _add_season(db_session, healthy, 2026, weeks=5, ppr_per_game=15.0)
        hurt = await _make_player(db_session, "Hurt Week Two")
        await _add_season(db_session, hurt, 2026, weeks=1, ppr_per_game=30.0)
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2026, "min_games": 3},
            headers=auth_headers,
        )
        names = [r["full_name"] for r in resp.json()]
        # 5 weeks played, so min_games=3 applies unclamped and excludes the
        # one-game player despite his flashy per-game average.
        assert names == ["Played Every Week"]

    async def test_thursday_night_refresh_does_not_hide_the_other_teams(
        self, client, auth_headers, db_session
    ):
        """The Friday bug: one team has two games, thirty have one, and clamping
        to max(week)=2 left only the Thursday teams on the page."""
        thursday = await _make_player(db_session, "Played Thursday", team="DET")
        await _add_season(
            db_session, thursday, 2026, weeks=2, ppr_per_game=21.0, team="DET"
        )
        for team in ("DAL", "KC", "SF"):
            waiting = await _make_player(db_session, f"Waiting {team}", team=team)
            await _add_season(
                db_session, waiting, 2026, weeks=1, ppr_per_game=18.0, team=team
            )
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2026, "min_games": 3},
            headers=auth_headers,
        )
        names = sorted(r["full_name"] for r in resp.json())
        assert names == ["Played Thursday", "Waiting DAL", "Waiting KC", "Waiting SF"]

    async def test_bye_week_does_not_hide_the_teams_on_bye(
        self, client, auth_headers, db_session
    ):
        """A bye and a game that hasn't kicked off look identical in the data --
        no row. Six weeks in, the floor is a real 3 either way."""
        playing = await _make_player(db_session, "No Bye Yet", team="DAL")
        await _add_season(
            db_session, playing, 2026, weeks=6, ppr_per_game=14.0, team="DAL"
        )
        on_bye = await _make_player(db_session, "Had A Bye", team="KC")
        await _add_season(
            db_session, on_bye, 2026, weeks=5, ppr_per_game=16.0, team="KC"
        )
        # On a team that has played six -- so he is judged against his team's
        # schedule, not given a pass because nobody in the league has played.
        cameo = await _make_player(db_session, "One Game Only", team="DAL")
        await _add_season(
            db_session, cameo, 2026, weeks=1, ppr_per_game=40.0, team="DAL"
        )
        await db_session.commit()

        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 2026, "min_games": 3},
            headers=auth_headers,
        )
        names = sorted(r["full_name"] for r in resp.json())
        # The bye team is in on five games; the one-game player is still cut.
        assert names == ["Had A Bye", "No Bye Yet"]

    async def test_season_with_no_data_returns_empty_not_error(
        self, client, auth_headers
    ):
        resp = await client.get(
            "/api/analytics/position-rankings",
            params={"position": "WR", "season": 1999},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []


class TestSeasonsDetail:
    async def test_reports_completeness_per_season(self, client, auth_headers, db_session):
        done = await _make_player(db_session, "Complete Season")
        await _add_season(db_session, done, 2025, weeks=18, ppr_per_game=15.0)
        live = await _make_player(db_session, "In Progress")
        await _add_season(db_session, live, 2026, weeks=2, ppr_per_game=20.0)
        await db_session.commit()

        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        assert resp.status_code == 200
        rows = {r["season"]: r for r in resp.json()}

        assert rows[2025]["is_complete"] is True
        assert rows[2025]["min_team_games"] == 18
        assert rows[2026]["is_complete"] is False
        assert rows[2026]["min_team_games"] == 2
        assert rows[2026]["max_games_played"] == 2

    async def test_newest_first(self, client, auth_headers, db_session):
        for season in (2024, 2026, 2025):
            p = await _make_player(db_session, f"Player {season}")
            await _add_season(db_session, p, season, weeks=18, ppr_per_game=10.0)
        await db_session.commit()

        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        seasons = [r["season"] for r in resp.json()]
        assert seasons == sorted(seasons, reverse=True)

    async def test_empty_database(self, client, auth_headers):
        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    async def test_partial_week_is_reported_as_counts(
        self, client, auth_headers, db_session
    ):
        """Mid-week the last week is only partly loaded. Report how many teams
        are in it rather than claiming the whole week as played."""
        thursday = await _make_player(db_session, "Thursday Guy", team="DET")
        await _add_season(
            db_session, thursday, 2026, weeks=2, ppr_per_game=21.0, team="DET"
        )
        for team in ("DAL", "KC"):
            p = await _make_player(db_session, f"Sunday {team}", team=team)
            await _add_season(
                db_session, p, 2026, weeks=1, ppr_per_game=12.0, team=team
            )
        await db_session.commit()

        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        row = {r["season"]: r for r in resp.json()}[2026]
        assert row["min_team_games"] == 1
        assert row["latest_week"] == 2
        assert row["teams_in_latest_week"] == 1
        assert row["total_teams"] == 3
        assert row["is_complete"] is False

    async def test_final_week_half_loaded_is_not_complete(
        self, client, auth_headers, db_session
    ):
        """Draft value picks the newest complete season for its replacement
        baseline, so a Saturday refresh in week 18 must not flip the flag."""
        done = await _make_player(db_session, "Finished 18", team="DET")
        await _add_season(
            db_session, done, 2025, weeks=18, ppr_per_game=15.0, team="DET"
        )
        behind = await _make_player(db_session, "Plays Sunday", team="DAL")
        await _add_season(
            db_session, behind, 2025, weeks=17, ppr_per_game=15.0, team="DAL"
        )
        await db_session.commit()

        resp = await client.get("/api/analytics/seasons/detail", headers=auth_headers)
        row = {r["season"]: r for r in resp.json()}[2025]
        assert row["is_complete"] is False
        assert row["teams_in_latest_week"] == 1
        assert row["total_teams"] == 2


class TestAnalyticsRequiresAuth:
    """The whole router was unauthenticated. Result sizes were already bounded
    (200 rows per query, 200 ids per batch), so a login was the missing half."""

    @pytest.mark.parametrize("path", [
        "/api/analytics/position-rankings?position=QB&season=2024",
        "/api/analytics/sparklines?player_ids=1,2",
        "/api/analytics/recent-form?player_ids=1,2&season=2024",
        "/api/analytics/seasons",
        "/api/analytics/seasons/detail",
    ])
    async def test_unauthenticated_request_is_refused(self, client, path):
        resp = await client.get(path)
        assert resp.status_code in (401, 403), f"{path} should require a login"
