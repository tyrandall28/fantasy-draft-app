import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { usePlayerCard } from "../context/PlayerCardContext";
import BoomBustChart from "../components/analytics/BoomBustChart";
import CompareRadarChart, { PLAYER_COLORS } from "../components/analytics/CompareRadarChart";
import TargetShareAirYardsChart from "../components/analytics/TargetShareAirYardsChart";
import FormSparkline from "../components/analytics/FormSparkline";
import PlayerHeadshot from "../components/analytics/PlayerHeadshot";
import PositionDataNotice from "../components/analytics/PositionDataNotice";
import { hasFantasyPoints, positionNotice } from "../lib/positionData";
import { isTierSort, positionalRanks, tierBandAt } from "../lib/tiers";
import type { PlayerDerivedStats, RecentFormData, SeasonInfo } from "../types";

// Leads with the part the "Last 8" header can't carry: it's eight games the
// *team* played, which is why a missed game still takes a slot.
const TREND_HELP =
  "PPR over the last 8 games this player's team played. Missed games still " +
  "take a slot. Rolls back into the " +
  "previous season when the current one is shorter. Green or red means the " +
  "window averages more than 12% above or below his own baseline (the ~17 " +
  "team games before it). A red x is a game his team played and he did not; " +
  "those are excluded from the average, not counted as zeros. The dashed " +
  "line is his baseline. Week 18 is skipped.";

type ViewTab = "rankings" | "boom-bust" | "compare" | "target-air";

const POSITIONS = ["QB", "RB", "WR", "TE", "K"] as const;

type SortField = keyof PlayerDerivedStats;

interface ColumnDef {
  key: SortField;
  label: string;
  format?: (v: number | null) => string;
  /** Ramp runs the other way: the LOW end of this column is the good end. */
  lowerIsBetter?: boolean;
  /**
   * Metric is signed by definition -- zero is a meaningful midpoint, not an
   * empty bar (EPA, CPOE). Gets no bar, because length drawn from an
   * arbitrary baseline reads as a magnitude it isn't. Declared per column
   * rather than inferred from the data: a metric that merely *happens* to
   * contain a negative this week (one backup QB's PPR/G) is still a magnitude.
   */
  signed?: boolean;
}

type CacheKey = `${string}-${number}`;

const fmt1 = (v: number | null) => (v != null ? v.toFixed(1) : "-");
const fmt2 = (v: number | null) => (v != null ? v.toFixed(2) : "-");
const fmtInt = (v: number | null) => (v != null ? String(Math.round(v)) : "-");
const fmtPct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "-");

const COLUMNS_BY_POSITION: Record<string, ColumnDef[]> = {
  // Passing and rushing each read TD-then-yards, and the two blocks sit
  // together, so a scan down the row tells you how a QB scores before it tells
  // you how efficiently he does it.
  QB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "pass_tds_per_game", label: "Pass TD/G", format: fmt2 },
    { key: "pass_yards_per_game", label: "Pass Yds/G", format: fmt1 },
    { key: "rush_tds_per_game", label: "Rush TD/G", format: fmt2 },
    { key: "rush_yards_per_game", label: "Rush Yds/G", format: fmt1 },
    { key: "completion_pct", label: "Comp%", format: fmtPct },
    { key: "int_per_game", label: "INT/G", format: fmt2, lowerIsBetter: true },
    { key: "cpoe", label: "CPOE", format: fmt1, signed: true },
    { key: "pass_epa_per_game", label: "EPA/G", format: fmt2, signed: true },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  RB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rush_yards_per_game", label: "Rush Yds/G", format: fmt1 },
    { key: "yards_per_carry", label: "Yds/Carry", format: fmt2 },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "catch_rate", label: "Catch%", format: fmtPct },
    { key: "snap_pct", label: "Snap%", format: fmtPct },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  WR: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rec_yards_per_game", label: "Rec Yds/G", format: fmt1 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "yards_per_target", label: "Yds/Tgt", format: fmt2 },
    { key: "catch_rate", label: "Catch%", format: fmtPct },
    { key: "target_share", label: "Tgt Share", format: fmtPct },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  TE: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rec_yards_per_game", label: "Rec Yds/G", format: fmt1 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "catch_rate", label: "Catch%", format: fmtPct },
    { key: "target_share", label: "Tgt Share", format: fmtPct },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "snap_pct", label: "Snap%", format: fmtPct },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  // No PPR columns: nflverse doesn't score kicking, so they'd be a column of
  // zeros. The notice above the table explains it; see lib/positionData.ts.
  K: [
    { key: "fg_made_per_game", label: "FG/G", format: fmt2 },
    { key: "fg_pct", label: "FG%", format: fmtPct },
    { key: "fg_long", label: "Long FG", format: fmtInt },
    { key: "xp_pct", label: "XP%", format: fmtPct },
  ],
};

/** Landing sort per position — never a metric that's structurally zero. */
const DEFAULT_SORT_BY_POSITION: Record<string, SortField> = {
  K: "fg_made_per_game",
};

const SMALL_SAMPLE_THRESHOLD = 8;

// Brightness ramp for the sorted column: the good end of the column reads as
// elite and the tail recedes, so a glance at the grid tells you where the value
// sits without reading the digits. Most metrics here are higher-is-better, but
// not all -- INT/G is won by the smallest number, and ramping it like the rest
// would light up the worst quarterbacks. `invert` flips which end is bright.
const CHALK_LOW = [107, 104, 98]; // --color-chalk-mut
const CHALK_HIGH = [237, 234, 227]; // --color-chalk

function heatColor(v: number, min: number, max: number, invert = false): string {
  const raw = max > min ? (v - min) / (max - min) : 1;
  const t = invert ? 1 - raw : raw;
  const [r, g, b] = CHALK_LOW.map((lo, i) => Math.round(lo + (CHALK_HIGH[i] - lo) * t));
  return `rgb(${r}, ${g}, ${b})`;
}

export default function AnalyticsPage() {
  const [position, setPosition] = useState<string>("QB");
  // Null until /seasons/detail answers. Seeding this with a guess fired a
  // throwaway request for that season, and whichever of the two responses
  // landed last won -- the selector said 2026 while the table showed 2025.
  const [season, setSeason] = useState<number | null>(null);
  const [seasonInfo, setSeasonInfo] = useState<SeasonInfo[]>([]);
  const [sortBy, setSortBy] = useState<SortField>("ppr_per_game");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [rawData, setRawData] = useState<PlayerDerivedStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("rankings");
  const { openPlayerCard } = usePlayerCard();
  const cache = useRef<Map<CacheKey, PlayerDerivedStats[]>>(new Map());
  const [forms, setForms] = useState<RecentFormData>({});
  const formCache = useRef<Map<string, RecentFormData>>(new Map());
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareSearch, setCompareSearch] = useState("");

  const currentSeasonInfo = useMemo(
    () => seasonInfo.find((info) => info.season === season) ?? null,
    [seasonInfo, season]
  );
  const activePositionNotice = positionNotice(position);
  // The trend sparkline plots PPR, which is structurally zero for kickers
  // and defenses -- a flat line at the axis reads as a broken chart.
  const showTrend = hasFantasyPoints(position);

  // Fetch the season inventory on mount. One request gives us both the
  // selector options and each season's completeness.
  useEffect(() => {
    apiFetch<SeasonInfo[]>("/api/analytics/seasons/detail").then((rows) => {
      if (rows.length > 0) {
        setSeasonInfo(rows);
        setSeason(rows[0].season);
      }
    });
  }, []);

  // Fetch data when position or season changes (NOT sort).
  //
  // `stale` guards the response, not just the mount: switch season or position
  // while a request is in flight and the slower one used to win, painting one
  // season's numbers under another season's heading. Cache the result either
  // way -- it's still valid for its own key -- but only the live request gets
  // to set what's on screen.
  useEffect(() => {
    if (!season) return;
    let stale = false;
    const key: CacheKey = `${position}-${season}`;
    const cached = cache.current.get(key);
    if (cached) {
      setRawData(cached);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      position,
      season: String(season),
      sort_by: "ppr_per_game",
      sort_dir: "desc",
      min_games: "3",
      limit: "100",
    });
    apiFetch<PlayerDerivedStats[]>(`/api/analytics/position-rankings?${params}`)
      .then((data) => {
        cache.current.set(key, data);
        if (!stale) setRawData(data);
      })
      .catch(() => {
        if (!stale) setRawData([]);
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });
    return () => {
      stale = true;
    };
  }, [position, season]);

  // Fetch recent form after rawData loads. Skipped entirely when the trend
  // column is hidden, so the K tab doesn't request 100 flat-zero series. The
  // window ends in the selected season, so the trend can't run past the stats
  // it sits beside.
  useEffect(() => {
    if (rawData.length === 0 || !showTrend || !season) return;
    let stale = false;
    const ids = rawData.map((p) => p.player_id);
    const cacheKey = `${season}:${[...ids].sort((a, b) => a - b).join(",")}`;
    const cached = formCache.current.get(cacheKey);
    if (cached) {
      setForms(cached);
      return;
    }
    apiFetch<RecentFormData>(
      `/api/analytics/recent-form?season=${season}&player_ids=${ids.join(",")}`
    )
      .then((data) => {
        formCache.current.set(cacheKey, data);
        if (!stale) setForms(data);
      })
      .catch(() => {
        if (!stale) setForms({});
      });
    return () => {
      stale = true;
    };
  }, [rawData, showTrend, season]);

  // Sort client-side
  const players = useMemo(() => {
    return [...rawData].sort((a, b) => {
      const aVal = a[sortBy] as number | null;
      const bVal = b[sortBy] as number | null;
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
  }, [rawData, sortBy, sortDir]);

  // Compare tab: selected players and search results
  const comparePlayers = useMemo(
    () => rawData.filter((p) => compareIds.includes(p.player_id)),
    [rawData, compareIds]
  );

  const compareSearchResults = useMemo(() => {
    if (!compareSearch.trim()) return [];
    const q = compareSearch.toLowerCase();
    return rawData
      .filter(
        (p) =>
          !compareIds.includes(p.player_id) &&
          p.full_name.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [rawData, compareSearch, compareIds]);

  // Clear compare selections when position changes
  useEffect(() => {
    setCompareIds([]);
    setCompareSearch("");
  }, [position]);

  const columns = COLUMNS_BY_POSITION[position] || COLUMNS_BY_POSITION["QB"];
  const columnCount = columns.length + (showTrend ? 2 : 1);

  // Tier bands only claim to be tiers when the sort makes the top 12 a real
  // one; otherwise they degrade to a plain row range. The rank badge beside
  // each name is always the value-metric rank, so it stays true either way.
  const isTier = isTierSort(position, sortBy, sortDir);
  const ranks = useMemo(() => positionalRanks(rawData, position), [rawData, position]);

  // Range of the sorted column, used for both the bar and the brightness ramp.
  // `barMax` is null only for columns declared `signed` (CPOE, EPA), where a
  // bar would misread as magnitude. It is NOT keyed off the data containing a
  // negative: a single backup QB at -0.38 PPR/G used to null this out and strip
  // the bars from every row of the column. Negatives clamp to an empty bar
  // instead. The ramp always applies -- relative standing is meaningful either way.
  const sortDomain = useMemo(() => {
    const vals = players
      .map((p) => p[sortBy] as number | null)
      .filter((v): v is number => v != null);
    if (vals.length === 0) return null;
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const signed = columns.find((c) => c.key === sortBy)?.signed ?? false;
    return { min, max, barMax: signed || max <= 0 ? null : max };
  }, [players, sortBy, columns]);

  // Early in a season every player is below the small-sample threshold, so
  // flagging them all says nothing -- it just paints the page amber. The
  // in-progress banner above the table already makes the point.
  const seasonComplete = !currentSeasonInfo || currentSeasonInfo.is_complete;

  const handleSort = (key: SortField) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto px-6 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-chalk">Analytics</h1>
        <p className="text-chalk-mut text-sm mt-1">
          Position rankings and player metrics
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="seg">
          {POSITIONS.map((pos) => {
            const notice = positionNotice(pos);
            return (
              <button
                key={pos}
                onClick={() => {
                  setPosition(pos);
                  // PPR/G is meaningless for positions without fantasy scoring,
                  // so don't land the user on a column of zeros.
                  setSortBy(DEFAULT_SORT_BY_POSITION[pos] ?? "ppr_per_game");
                  setSortDir("desc");
                  if (activeTab === "target-air" && pos !== "WR" && pos !== "TE") {
                    setActiveTab("rankings");
                  }
                }}
                title={notice ? notice.title : undefined}
                className={`seg-item flex items-center gap-1.5 ${
                  position === pos
                    ? "seg-item-active"
                    : notice
                      ? "!text-chalk-mut/60 hover:!text-chalk-mut"
                      : ""
                }`}
              >
                {pos}
                {notice && (
                  <span
                    className={`rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide ${
                      position === pos
                        ? "bg-accent-ink/20 text-accent-ink"
                        : "bg-caution/10 text-caution/70"
                    }`}
                  >
                    {notice.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <select
          value={season ?? ""}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="bg-ink-800 border border-ink-600 text-chalk-dim text-sm rounded-lg px-3 py-1.5"
        >
          {seasonInfo.map((info) => (
            <option key={info.season} value={info.season} className="bg-ink-800">
              {info.season}
              {info.is_complete ? "" : " (in progress)"}
            </option>
          ))}
        </select>

        {/* View tabs */}
        <div className="seg ml-auto">
          {([
            { key: "rankings" as ViewTab, label: "Rankings" },
            { key: "boom-bust" as ViewTab, label: "Boom / Bust" },
            { key: "compare" as ViewTab, label: "Compare" },
            ...((position === "WR" || position === "TE")
              ? [{ key: "target-air" as ViewTab, label: "Tgt / Air Yds" }]
              : []),
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`seg-item ${activeTab === tab.key ? "seg-item-active" : ""}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Why this position's analytics are incomplete, above whatever real data
          it does have. */}
      {activePositionNotice && (
        <div className="mb-4">
          <PositionDataNotice notice={activePositionNotice} />
        </div>
      )}

      {/* In-progress season notice. Early in a season every per-game rate comes
          off a one- or two-game sample, so the leaderboard is mostly noise —
          say so rather than presenting it as settled.

          The two counts are separate on purpose. Refreshing mid-week loads the
          Thursday game and nothing else, so "data through week 2" would be true
          of two teams and wrong about the other thirty. State what every team
          has played, then the partial week as a raw count — which reads
          correctly during a bye week too, where a finished week legitimately
          has 26 of 32 teams in it. */}
      {currentSeasonInfo && !currentSeasonInfo.is_complete && currentSeasonInfo.min_team_games > 0 && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-caution/20 bg-caution/5 px-4 py-3">
          <span className="text-caution text-sm leading-5">●</span>
          <p className="text-sm text-chalk-dim leading-5">
            <span className="font-medium text-caution">
              {currentSeasonInfo.season} season in progress
            </span>{" "}
            — every team has played {currentSeasonInfo.min_team_games} of{" "}
            {currentSeasonInfo.regular_season_weeks} games.
            {currentSeasonInfo.teams_in_latest_week < currentSeasonInfo.total_teams && (
              <>
                {" "}
                Week {currentSeasonInfo.latest_week} is partly loaded:{" "}
                {currentSeasonInfo.teams_in_latest_week} of{" "}
                {currentSeasonInfo.total_teams} teams have played it, so those
                players carry an extra game.
              </>
            )}{" "}
            Per-game averages come from as few as {currentSeasonInfo.min_team_games}{" "}
            {currentSeasonInfo.min_team_games === 1 ? "game" : "games"}, so rankings
            will swing a lot week to week.{" "}
            {seasonInfo.length > 1 && (
              <>
                Pick {currentSeasonInfo.season - 1} for a full season.
              </>
            )}
          </p>
        </div>
      )}

      {/* Boom/Bust Scatter Chart */}
      {activeTab === "boom-bust" && (
        <div className="panel rounded-xl p-5">
          <h2 className="text-lg font-semibold text-chalk mb-1">
            Boom / Bust — {position}s
          </h2>
          <p className="text-chalk-mut text-sm mb-4">
            Median weekly PPR (typical week) vs. standard deviation (how much it swings)
          </p>
          <BoomBustChart data={rawData} position={position} />
        </div>
      )}

      {/* Compare Radar Chart */}
      {activeTab === "compare" && (
        <div className="panel rounded-xl p-5">
          <h2 className="text-lg font-semibold text-chalk mb-1">
            Player Comparison — {position}s
          </h2>
          <p className="text-chalk-mut text-sm mb-4">
            Compare 2–3 players side by side. Values shown as percentile rank within the position group.
          </p>

          {/* Player selector */}
          <div className="flex flex-wrap items-start gap-3 mb-5">
            {/* Selected pills */}
            <div className="flex flex-wrap gap-2">
              {comparePlayers.map((p, i) => (
                <span
                  key={p.player_id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium"
                  style={{
                    backgroundColor: PLAYER_COLORS[i % 3] + "22",
                    color: PLAYER_COLORS[i % 3],
                    border: `1px solid ${PLAYER_COLORS[i % 3]}44`,
                  }}
                >
                  {p.full_name}
                  <button
                    onClick={() => setCompareIds((ids) => ids.filter((id) => id !== p.player_id))}
                    className="ml-0.5 hover:opacity-70 text-xs"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>

            {/* Search input */}
            {compareIds.length < 3 && (
              <div className="relative">
                <input
                  type="text"
                  placeholder={compareIds.length === 0 ? "Search players to compare..." : "Add another player..."}
                  value={compareSearch}
                  onChange={(e) => setCompareSearch(e.target.value)}
                  className="bg-ink-800 border border-ink-600 text-chalk text-sm rounded-lg px-3 py-1.5 w-64 placeholder:text-chalk-mut focus:outline-none focus:border-chalk-mut"
                />
                {compareSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-full panel-float z-10 overflow-hidden">
                    {compareSearchResults.map((p) => (
                      <button
                        key={p.player_id}
                        onClick={() => {
                          setCompareIds((ids) => [...ids, p.player_id]);
                          setCompareSearch("");
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-chalk-dim hover:bg-ink-700 hover:text-chalk"
                      >
                        {p.full_name}
                        <span className="text-chalk-mut ml-2 text-xs">{p.nfl_team}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Radar chart + stats table or prompt */}
          {comparePlayers.length < 2 ? (
            <div className="flex items-center justify-center h-[400px] text-chalk-mut">
              Select {comparePlayers.length === 0 ? "2–3" : "1 more"} player{comparePlayers.length === 0 ? "s" : ""} to compare
            </div>
          ) : (
            <div className="flex gap-5 items-start">
              {/* Radar */}
              <div className="flex-1 min-w-0">
                <CompareRadarChart
                  allPlayers={rawData}
                  selectedPlayers={comparePlayers}
                  position={position}
                />
              </div>

              {/* Side-by-side stats table */}
              <div className="w-auto shrink-0 overflow-x-auto">
                <table className="text-sm">
                  <thead>
                    <tr className="border-b border-ink-600">
                      <th className="text-left text-chalk-mut font-medium px-3 py-2 whitespace-nowrap">Stat</th>
                      {comparePlayers.map((p, i) => (
                        <th
                          key={p.player_id}
                          className="text-right font-medium px-3 py-2 whitespace-nowrap"
                          style={{ color: PLAYER_COLORS[i % 3] }}
                        >
                          {p.full_name.split(" ").pop()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Team row */}
                    <tr className="border-b border-ink-600/50">
                      <td className="text-chalk-mut px-3 py-1.5">Team</td>
                      {comparePlayers.map((p) => (
                        <td key={p.player_id} className="text-right text-chalk-dim px-3 py-1.5 stat-num">
                          {p.nfl_team}
                        </td>
                      ))}
                    </tr>
                    {/* Games played */}
                    <tr className="border-b border-ink-600/50">
                      <td className="text-chalk-mut px-3 py-1.5">GP</td>
                      {comparePlayers.map((p) => (
                        <td key={p.player_id} className="text-right text-chalk-dim px-3 py-1.5 stat-num">
                          {p.games_played}
                        </td>
                      ))}
                    </tr>
                    {/* Stat columns */}
                    {columns.map((col) => {
                      // Find the best value for highlighting
                      const vals = comparePlayers.map((p) => p[col.key] as number | null);
                      const validVals = vals.filter((v): v is number => v != null);
                      const best = validVals.length > 0 ? Math.max(...validVals) : null;

                      return (
                        <tr key={col.key} className="border-b border-ink-600/50">
                          <td className="text-chalk-mut px-3 py-1.5 whitespace-nowrap">{col.label}</td>
                          {comparePlayers.map((p) => {
                            const val = p[col.key] as number | null;
                            const isBest = val != null && best != null && val === best && validVals.length > 1;
                            return (
                              <td
                                key={p.player_id}
                                className={`text-right px-3 py-1.5 stat-num ${
                                  isBest ? "text-accent font-semibold" : "text-chalk-dim"
                                }`}
                              >
                                {col.format ? col.format(val) : val != null ? String(val) : "-"}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Target Share vs Air Yards Chart */}
      {activeTab === "target-air" && (
        <div className="panel rounded-xl p-5">
          <h2 className="text-lg font-semibold text-chalk mb-1">
            Target Share vs Air Yards — {position}s
          </h2>
          <p className="text-chalk-mut text-sm mb-4">
            Volume (target share) vs. opportunity quality (air yards per game).
            Top-right = alpha receivers getting both volume and deep looks.
          </p>
          <TargetShareAirYardsChart data={rawData} position={position} />
        </div>
      )}

      {/* Position Rankings Table */}
      {activeTab === "rankings" && (
      <div className="panel rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          {/* table-fixed, not auto. Auto layout hands every column a share of
              the slack in proportion to its content, so "Rush Yds/G" ended up
              visibly wider than "CPOE" and the last pair looked mismatched.
              Fixed layout plus this colgroup gives the identity column a set
              share and splits the rest evenly, so the stat grid reads as one
              rhythm at any column count. min-w keeps the widest header from
              being crushed on a narrow window -- it scrolls instead. */}
          <table className="w-full table-fixed border-separate border-spacing-0 min-w-[1400px]">
            <colgroup>
              <col className="w-[20%]" />
              {/* Wide enough for the 84px sparkline plus the cell's px-4: at
                  the 1400px floor 9% is 126px, leaving a 94px content box. At
                  6% the SVG overflowed its cell by ~16px a side and bled into
                  the next column. */}
              {showTrend && <col className="w-[9%]" />}
              {columns.map((col) => (
                <col key={col.key} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* Sticky with the identity cells below it, so the anchor
                    survives horizontal scroll on a narrow window. */}
                <th className="sticky left-0 z-20 bg-ink-800 text-left text-chalk-mut text-xs font-medium px-5 py-3 border-b border-ink-600">
                  Player
                </th>
                {showTrend && (
                  <th
                    className="bg-ink-800 text-center text-chalk-mut text-xs font-medium px-4 py-3 border-b border-ink-600"
                    title={TREND_HELP}
                  >
                    <span className="border-b border-dotted border-chalk-mut cursor-help">
                      Last 8
                    </span>
                  </th>
                )}
                {columns.map((col) => {
                  const active = sortBy === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => handleSort(col.key)}
                      className={`bg-ink-800 text-right text-xs font-medium px-3 py-3 cursor-pointer select-none whitespace-nowrap border-b border-ink-600 transition-colors ${
                        active ? "text-accent" : "text-chalk-mut hover:text-chalk-dim"
                      }`}
                    >
                      {/* Ahead of the label, not after it. These headers are
                          right-aligned over right-aligned numbers, and the
                          arrow's box is reserved on every column so the header
                          doesn't jump when you sort. Sitting after the label
                          that reserved box pushed the *visible* text ~13px in
                          from the edge the numbers align to, so every unsorted
                          column read as misaligned. In front, the same
                          reservation falls into the column's left whitespace. */}
                      <span
                        className={`mr-1 text-[9px] align-middle ${
                          active ? "text-accent" : "text-transparent"
                        }`}
                      >
                        {sortDir === "desc" ? "▼" : "▲"}
                      </span>
                      {col.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {loading && players.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="text-center text-chalk-mut py-16 text-base">
                    Loading...
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={columnCount} className="text-center text-chalk-dim py-16 text-base">
                    {!season ? (
                      "Loading..."
                    ) : currentSeasonInfo && currentSeasonInfo.latest_week === 0 ? (
                      <>
                        No {season} game data has been ingested yet.
                        <span className="block mt-1 text-sm text-chalk-mut">
                          Run <code className="text-chalk-dim">python -m scripts.doctor</code> to
                          see what's loaded.
                        </span>
                      </>
                    ) : (
                      <>No {position}s match the current filters for {season}.</>
                    )}
                  </td>
                </tr>
              ) : (
                players.flatMap((p, i) => {
                  const band = tierBandAt(i, position, isTier);
                  const rank = ranks.get(p.player_id);
                  const shortSample = seasonComplete && p.games_played < SMALL_SAMPLE_THRESHOLD;

                  const rows = [];
                  if (band) {
                    rows.push(
                      <tr key={`band-${i}`}>
                        <td colSpan={columnCount} className="bg-ink-800 px-5 pt-6 pb-2">
                          <div className="flex items-center gap-3">
                            <span className={`text-xs font-semibold tracking-wide ${
                              isTier ? "text-accent" : "text-chalk-dim"
                            }`}>
                              {band.label}
                            </span>
                            <span className="flex-1 h-px bg-ink-600" />
                            <span className="text-chalk-mut text-[11px] tnum">
                              {band.range}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  rows.push(
                    <tr key={p.player_id} className="group">
                      <td className="sticky left-0 z-10 bg-ink-800 group-hover:bg-ink-700 border-b border-ink-600/60 px-5 py-4 transition-colors">
                        <div className="flex items-center gap-3">
                          <span className="text-chalk-mut text-xs tnum w-6 shrink-0 text-right">
                            {i + 1}
                          </span>
                          <PlayerHeadshot url={p.headshot_url} name={p.full_name} />
                          <div className="min-w-0">
                            <button
                              onClick={() => openPlayerCard(p.player_id)}
                              title={p.full_name}
                              className="block w-full truncate text-chalk text-[15px] font-medium leading-tight hover:underline underline-offset-4 decoration-chalk-mut text-left"
                            >
                              {p.full_name}
                            </button>
                            <p className="truncate text-chalk-mut text-xs mt-1 leading-none">
                              {p.nfl_team}
                              {rank != null && <> &middot; {position}{rank}</>}
                              {" "}&middot;{" "}
                              <span className={shortSample ? "text-caution" : undefined}>
                                {p.games_played} gm
                              </span>
                            </p>
                          </div>
                        </div>
                      </td>

                      {showTrend && (
                        <td className="text-center px-4 py-4 border-b border-ink-600/60 group-hover:bg-ink-700 transition-colors">
                          <FormSparkline form={forms[p.player_id] ?? null} />
                        </td>
                      )}

                      {columns.map((col) => {
                        const val = p[col.key] as number | null;
                        const active = sortBy === col.key;
                        // No bar on a lower-is-better column: length reads as
                        // "more of a good thing", and on INT/G the longest bar
                        // would belong to the worst quarterback. The ramp still
                        // applies -- it just runs the other way.
                        const fill =
                          active && !col.lowerIsBetter && sortDomain?.barMax != null && val != null
                            ? Math.max(0, Math.min(1, val / sortDomain.barMax)) * 100
                            : 0;
                        // Only the sorted column ramps. Running it on all ten
                        // would turn the grid into noise and stop the column
                        // you're actually reading from standing out.
                        const ramp =
                          active && sortDomain && val != null
                            ? heatColor(val, sortDomain.min, sortDomain.max, col.lowerIsBetter)
                            : undefined;
                        return (
                          <td
                            key={col.key}
                            className={`relative text-right px-3 py-4 stat-num text-sm border-b border-ink-600/60 group-hover:bg-ink-700 transition-colors ${
                              active ? "text-chalk" : "text-chalk-dim"
                            }`}
                          >
                            {fill > 0 && (
                              // Track, then fill. The fill is a percentage of
                              // the track, not of the cell, so a 100% bar stops
                              // short of both edges instead of running flush
                              // into the neighbouring column -- at the left edge
                              // that meant painting over the Form sparkline's
                              // most recent game.
                              <span
                                aria-hidden
                                className="absolute inset-y-2 left-1 right-1 pointer-events-none"
                              >
                                <span
                                  className="absolute inset-y-0 right-0 bg-accent/15 rounded-sm"
                                  style={{ width: `${fill}%` }}
                                />
                              </span>
                            )}
                            <span
                              className={`relative ${active ? "font-medium" : ""}`}
                              style={ramp ? { color: ramp } : undefined}
                            >
                              {col.format
                                ? col.format(val)
                                : val != null ? String(val) : "-"}
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  );
                  return rows;
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Only worth saying when *some* players are short of a full sample. Mid-season
          that's the injured guys; in week 1 it's everyone, and the notice above
          already covers it. */}
      {activeTab === "rankings" &&
        seasonComplete &&
        players.some((p) => p.games_played < SMALL_SAMPLE_THRESHOLD) && (
          <p className="mt-3 text-xs text-chalk-mut">
            <span className="text-caution">*</span> Players with fewer than {SMALL_SAMPLE_THRESHOLD} games — per-game rates may be inflated
          </p>
        )}
    </div>
  );
}
