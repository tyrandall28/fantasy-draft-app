"""Which NFL season is it right now?

Every ingest CLI used to hardcode a default year (`--year 2025`), which quietly
rots: run the refresh in 2026 and you'd repopulate 2025 data without noticing.
These helpers derive the season from the calendar instead, so the defaults are
always right and you only pass an explicit year when you *mean* to.

An NFL season labelled Y runs from September Y through February Y+1, and fantasy
ranking sources publish their Y lists in the spring of Y.
"""
from datetime import date

# Rankings for season Y start appearing this month of year Y. Before it, "now"
# still belongs to the season that kicked off the previous September.
_SEASON_ROLLOVER_MONTH = 3

# Weeks in a full NFL regular season (18 since 2021). A season with this many
# weeks of data is complete; fewer means it's still being played.
REGULAR_SEASON_WEEKS = 18


def current_nfl_season(today: date | None = None) -> int:
    """The season being played right now, or the next one if we're in the offseason.

    >>> current_nfl_season(date(2026, 9, 15))   # week 2 of the 2026 season
    2026
    >>> current_nfl_season(date(2027, 1, 10))   # 2026 playoffs
    2026
    >>> current_nfl_season(date(2026, 4, 1))    # offseason, 2026 lists are out
    2026
    """
    today = today or date.today()
    return today.year if today.month >= _SEASON_ROLLOVER_MONTH else today.year - 1


def latest_completed_season(today: date | None = None) -> int:
    """The most recent season with a full set of results.

    Always one behind `current_nfl_season` — in March of year Y the season that
    just finished is Y-1, and from September Y onward season Y is still in
    progress.
    """
    return current_nfl_season(today) - 1


def approx_current_week(today: date | None = None) -> int | None:
    """Roughly which week of the current season we're in, or None in the offseason.

    Week 1 kicks off the Thursday after Labor Day, near Sept 5. This is an
    approximation used only to flag "your weekly data looks a couple of weeks
    behind the calendar" -- never to decide what to ingest.
    """
    today = today or date.today()
    season = current_nfl_season(today)
    kickoff = date(season, 9, 5)
    if today < kickoff:
        return None
    week = (today - kickoff).days // 7 + 1
    # Regular season + playoffs run about 22 weeks; past that we're done.
    return week if week <= 22 else None


def default_stat_seasons(today: date | None = None, history: int = 4) -> list[int]:
    """Seasons the stats ingester should pull by default.

    The last `history` completed seasons plus the in-progress one, so an
    in-season refresh picks up new weeks as they're played.

    >>> default_stat_seasons(date(2026, 9, 15))
    [2022, 2023, 2024, 2025, 2026]
    """
    current = current_nfl_season(today)
    oldest = latest_completed_season(today) - history + 1
    return list(range(oldest, current + 1))
