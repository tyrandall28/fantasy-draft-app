import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import { usePlayerCard } from "../context/PlayerCardContext";
import BoomBustChart from "../components/analytics/BoomBustChart";
import CompareRadarChart from "../components/analytics/CompareRadarChart";
import TargetShareAirYardsChart from "../components/analytics/TargetShareAirYardsChart";
import Sparkline from "../components/analytics/Sparkline";
import type { PlayerDerivedStats } from "../types";

interface SparklinePoint {
  season: number;
  ppr_per_game: number | null;
  games_played: number;
}

type SparklineData = Record<number, SparklinePoint[]>;

type ViewTab = "rankings" | "boom-bust" | "compare" | "target-air";

const POSITIONS = ["QB", "RB", "WR", "TE", "K"] as const;

type SortField = keyof PlayerDerivedStats;

interface ColumnDef {
  key: SortField;
  label: string;
  format?: (v: number | null) => string;
}

type CacheKey = `${string}-${number}`;

const fmt1 = (v: number | null) => (v != null ? v.toFixed(1) : "-");
const fmt2 = (v: number | null) => (v != null ? v.toFixed(2) : "-");
const fmtInt = (v: number | null) => (v != null ? String(Math.round(v)) : "-");
const fmtPct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "-");

const COLUMNS_BY_POSITION: Record<string, ColumnDef[]> = {
  QB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "pass_yards_per_game", label: "Pass Yds/G", format: fmt1 },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "completion_pct", label: "Comp%", format: fmtPct },
    { key: "cpoe", label: "CPOE", format: fmt1 },
    { key: "pass_epa_per_game", label: "EPA/G", format: fmt2 },
    { key: "rush_yards_per_game", label: "Rush Yds/G", format: fmt1 },
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
  K: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "fg_pct", label: "FG%", format: fmtPct },
    { key: "fg_made_per_game", label: "FG/G", format: fmt2 },
    { key: "fg_long", label: "Long FG", format: fmtInt },
    { key: "xp_pct", label: "XP%", format: fmtPct },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
};

const SMALL_SAMPLE_THRESHOLD = 8;

export default function AnalyticsPage() {
  const [position, setPosition] = useState<string>("QB");
  const [season, setSeason] = useState<number>(2025);
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([]);
  const [sortBy, setSortBy] = useState<SortField>("ppr_per_game");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [rawData, setRawData] = useState<PlayerDerivedStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>("rankings");
  const { openPlayerCard } = usePlayerCard();
  const cache = useRef<Map<CacheKey, PlayerDerivedStats[]>>(new Map());
  const [sparklines, setSparklines] = useState<SparklineData>({});
  const sparklineCache = useRef<Map<string, SparklineData>>(new Map());
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [compareSearch, setCompareSearch] = useState("");

  // Fetch available seasons on mount
  useEffect(() => {
    apiFetch<number[]>("/api/analytics/seasons").then((seasons) => {
      if (seasons.length > 0) {
        setAvailableSeasons(seasons);
        setSeason(seasons[0]);
      }
    });
  }, []);

  // Fetch data when position or season changes (NOT sort)
  useEffect(() => {
    if (!season) return;
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
        setRawData(data);
      })
      .catch(() => setRawData([]))
      .finally(() => setLoading(false));
  }, [position, season]);

  // Fetch sparkline data after rawData loads
  useEffect(() => {
    if (rawData.length === 0) return;
    const ids = rawData.map((p) => p.player_id);
    const cacheKey = ids.sort().join(",");
    const cached = sparklineCache.current.get(cacheKey);
    if (cached) {
      setSparklines(cached);
      return;
    }
    apiFetch<SparklineData>(`/api/analytics/sparklines?player_ids=${ids.join(",")}`)
      .then((data) => {
        sparklineCache.current.set(cacheKey, data);
        setSparklines(data);
      })
      .catch(() => setSparklines({}));
  }, [rawData]);

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

  const handleSort = (key: SortField) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Analytics</h1>
        <p className="text-slate-400 text-sm mt-1">
          Position rankings and player metrics
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex bg-white/5 rounded-lg p-0.5">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => {
                setPosition(pos);
                setSortBy("ppr_per_game");
                setSortDir("desc");
                if (activeTab === "target-air" && pos !== "WR" && pos !== "TE") {
                  setActiveTab("rankings");
                }
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-md ${
                position === pos
                  ? "bg-sky-500 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>

        <select
          value={season}
          onChange={(e) => setSeason(Number(e.target.value))}
          className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5"
        >
          {availableSeasons.map((s) => (
            <option key={s} value={s} className="bg-[#1a1d28]">
              {s}
            </option>
          ))}
        </select>

        {/* View tabs */}
        <div className="flex bg-white/5 rounded-lg p-0.5 ml-auto">
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
              className={`px-4 py-1.5 text-sm font-medium rounded-md ${
                activeTab === tab.key
                  ? "bg-sky-500 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Boom/Bust Scatter Chart */}
      {activeTab === "boom-bust" && (
        <div className="bg-[#12141b] border border-white/5 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-1">
            Boom / Bust — {position}s
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Median weekly PPR (typical week) vs. standard deviation (how much it swings)
          </p>
          <BoomBustChart data={rawData} position={position} />
        </div>
      )}

      {/* Compare Radar Chart */}
      {activeTab === "compare" && (
        <div className="bg-[#12141b] border border-white/5 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-1">
            Player Comparison — {position}s
          </h2>
          <p className="text-slate-400 text-sm mb-4">
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
                    backgroundColor: ["#38bdf8", "#f59e0b", "#a78bfa"][i % 3] + "22",
                    color: ["#38bdf8", "#f59e0b", "#a78bfa"][i % 3],
                    border: `1px solid ${["#38bdf8", "#f59e0b", "#a78bfa"][i % 3]}44`,
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
                  className="bg-white/5 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 w-64 placeholder:text-slate-500 focus:outline-none focus:border-sky-500/50"
                />
                {compareSearchResults.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 w-full bg-[#1a1d28] border border-white/10 rounded-lg shadow-xl z-10 overflow-hidden">
                    {compareSearchResults.map((p) => (
                      <button
                        key={p.player_id}
                        onClick={() => {
                          setCompareIds((ids) => [...ids, p.player_id]);
                          setCompareSearch("");
                        }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-300 hover:bg-white/5 hover:text-white"
                      >
                        {p.full_name}
                        <span className="text-slate-500 ml-2 text-xs">{p.nfl_team}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Radar chart + stats table or prompt */}
          {comparePlayers.length < 2 ? (
            <div className="flex items-center justify-center h-[400px] text-slate-500">
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
                    <tr className="border-b border-white/10">
                      <th className="text-left text-slate-500 font-medium px-3 py-2 whitespace-nowrap">Stat</th>
                      {comparePlayers.map((p, i) => (
                        <th
                          key={p.player_id}
                          className="text-right font-medium px-3 py-2 whitespace-nowrap"
                          style={{ color: ["#38bdf8", "#f59e0b", "#a78bfa"][i % 3] }}
                        >
                          {p.full_name.split(" ").pop()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Team row */}
                    <tr className="border-b border-white/[0.04]">
                      <td className="text-slate-500 px-3 py-1.5">Team</td>
                      {comparePlayers.map((p) => (
                        <td key={p.player_id} className="text-right text-slate-300 px-3 py-1.5 font-mono">
                          {p.nfl_team}
                        </td>
                      ))}
                    </tr>
                    {/* Games played */}
                    <tr className="border-b border-white/[0.04]">
                      <td className="text-slate-500 px-3 py-1.5">GP</td>
                      {comparePlayers.map((p) => (
                        <td key={p.player_id} className="text-right text-slate-300 px-3 py-1.5 font-mono">
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
                        <tr key={col.key} className="border-b border-white/[0.04]">
                          <td className="text-slate-500 px-3 py-1.5 whitespace-nowrap">{col.label}</td>
                          {comparePlayers.map((p) => {
                            const val = p[col.key] as number | null;
                            const isBest = val != null && best != null && val === best && validVals.length > 1;
                            return (
                              <td
                                key={p.player_id}
                                className={`text-right px-3 py-1.5 font-mono ${
                                  isBest ? "text-emerald-400 font-semibold" : "text-slate-300"
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
        <div className="bg-[#12141b] border border-white/5 rounded-xl p-5">
          <h2 className="text-lg font-semibold text-white mb-1">
            Target Share vs Air Yards — {position}s
          </h2>
          <p className="text-slate-400 text-sm mb-4">
            Volume (target share) vs. opportunity quality (air yards per game).
            Top-right = alpha receivers getting both volume and deep looks.
          </p>
          <TargetShareAirYardsChart data={rawData} position={position} />
        </div>
      )}

      {/* Position Rankings Table */}
      {activeTab === "rankings" && (
      <div className="bg-[#12141b] border border-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                <th className="text-left text-slate-500 text-sm font-medium px-5 py-3.5 w-10">#</th>
                <th className="text-left text-slate-500 text-sm font-medium px-5 py-3.5">Player</th>
                <th className="text-center text-slate-500 text-sm font-medium px-4 py-3.5">GP</th>
                <th className="text-center text-slate-500 text-sm font-medium px-4 py-3.5">Trend</th>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className="text-right text-slate-500 text-sm font-medium px-4 py-3.5 cursor-pointer hover:text-white select-none whitespace-nowrap"
                  >
                    {col.label}
                    {sortBy === col.key && (
                      <span className="text-sky-400 text-xs ml-1">
                        {sortDir === "desc" ? "\u25BC" : "\u25B2"}
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && players.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 4} className="text-center text-slate-500 py-16 text-base">
                    Loading...
                  </td>
                </tr>
              ) : players.length === 0 ? (
                <tr>
                  <td colSpan={columns.length + 4} className="text-center text-slate-500 py-16 text-base">
                    No data available. Run the ingestion pipeline with step 6.
                  </td>
                </tr>
              ) : (
                players.map((p, i) => (
                  <tr key={p.player_id} className="border-b border-white/[0.03]">
                    <td className="px-5 py-3.5 text-slate-500 text-sm">{i + 1}</td>
                    <td className="px-5 py-3.5">
                      <span
                        onClick={() => openPlayerCard(p.player_id)}
                        className="text-white text-[15px] font-medium cursor-pointer hover:text-sky-400"
                      >
                        {p.full_name}
                      </span>
                      <span className="text-slate-500 text-sm ml-2">{p.nfl_team}</span>
                      {p.games_played < SMALL_SAMPLE_THRESHOLD && (
                        <span className="text-amber-400/80 text-xs ml-1">({p.games_played}g)</span>
                      )}
                    </td>
                    <td className="text-center px-4 py-3.5 text-slate-400 text-sm">{p.games_played}</td>
                    <td className="text-center px-4 py-3.5">
                      <Sparkline data={sparklines[p.player_id] ?? []} />
                    </td>
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={`text-right px-4 py-3.5 font-mono text-sm ${
                          sortBy === col.key ? "text-sky-300" : "text-slate-300"
                        }`}
                      >
                        {col.format
                          ? col.format(p[col.key] as number | null)
                          : p[col.key] != null ? String(p[col.key]) : "-"}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {activeTab === "rankings" && players.some((p) => p.games_played < SMALL_SAMPLE_THRESHOLD) && (
        <p className="mt-3 text-xs text-slate-500">
          <span className="text-amber-400/80">*</span> Players with fewer than {SMALL_SAMPLE_THRESHOLD} games — per-game rates may be inflated
        </p>
      )}
    </div>
  );
}
