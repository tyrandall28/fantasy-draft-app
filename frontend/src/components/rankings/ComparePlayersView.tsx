import CompareRadarChart from "../analytics/CompareRadarChart";
import HeadToHeadWeeklyChart from "../analytics/HeadToHeadWeeklyChart";
import PlayerAnalyticsColumn from "./PlayerAnalyticsColumn";
import type {
  PlayerDerivedStats,
  PlayerWeekly,
  SparklinePoint,
  UserRankingEntry,
} from "../../types";

const PLAYER_TEXT_COLORS = ["#38bdf8", "#f59e0b"]; // matches CompareRadarChart and H2H chart

const fmt1 = (v: number | null) => (v != null ? v.toFixed(1) : "-");
const fmt2 = (v: number | null) => (v != null ? v.toFixed(2) : "-");
const fmtPct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "-");

interface StatRowDef {
  key: keyof PlayerDerivedStats;
  label: string;
  format: (v: number | null) => string;
}

const STATS_BY_POSITION: Record<string, StatRowDef[]> = {
  QB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "pass_yards_per_game", label: "Pass Y/G", format: fmt1 },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "completion_pct", label: "Comp%", format: fmtPct },
    { key: "cpoe", label: "CPOE", format: fmt1 },
    { key: "rush_yards_per_game", label: "Rush Y/G", format: fmt1 },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  RB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rush_yards_per_game", label: "Rush Y/G", format: fmt1 },
    { key: "yards_per_carry", label: "YPC", format: fmt2 },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "snap_pct", label: "Snap%", format: fmtPct },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  WR: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rec_yards_per_game", label: "Rec Y/G", format: fmt1 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "yards_per_target", label: "Y/Tgt", format: fmt2 },
    { key: "target_share", label: "Tgt Share", format: fmtPct },
    { key: "tds_per_game", label: "TDs/G", format: fmt2 },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  TE: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rec_yards_per_game", label: "Rec Y/G", format: fmt1 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "catch_rate", label: "Catch%", format: fmtPct },
    { key: "target_share", label: "Tgt Share", format: fmtPct },
    { key: "snap_pct", label: "Snap%", format: fmtPct },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
  K: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "fg_pct", label: "FG%", format: fmtPct },
    { key: "fg_made_per_game", label: "FG/G", format: fmt2 },
    { key: "xp_pct", label: "XP%", format: fmtPct },
    { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
  ],
};

// Shared cross-position metrics: universal stats that work for comparing different positions
const CROSS_POSITION_STATS: StatRowDef[] = [
  { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
  { key: "tds_per_game", label: "TDs/G", format: fmt2 },
  { key: "total_yards", label: "Total Yds", format: (v) => (v != null ? String(Math.round(v)) : "-") },
  { key: "snap_pct", label: "Snap%", format: fmtPct },
  { key: "fantasy_points_ppr", label: "Total PPR", format: fmt1 },
];

interface SelectedPlayer {
  entry: UserRankingEntry;
  stats: PlayerDerivedStats | null;
  sparkline: SparklinePoint[];
  weekly: PlayerWeekly[];
  positionGroup: PlayerDerivedStats[];
}

interface Props {
  players: SelectedPlayer[];
  loading: boolean;
}

export default function ComparePlayersView({ players, loading }: Props) {
  const [a, b] = players;
  const samePosition = a.entry.player.position === b.entry.player.position;
  const statRows = samePosition
    ? STATS_BY_POSITION[a.entry.player.position] ?? CROSS_POSITION_STATS
    : CROSS_POSITION_STATS;

  const canShowRadar =
    samePosition && a.stats != null && b.stats != null && a.positionGroup.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Head-to-Head weekly overlay chart — works for ANY two players */}
      <div>
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Head-to-Head Weekly
        </h4>
        <div className="bg-white/[0.02] border border-white/5 rounded-lg p-3">
          <HeadToHeadWeeklyChart
            weeksA={a.weekly}
            weeksB={b.weekly}
            nameA={a.entry.player.full_name}
            nameB={b.entry.player.full_name}
          />
        </div>
      </div>

      {/* Radar chart (same position only) */}
      {canShowRadar && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Percentile Comparison
          </h4>
          <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2">
            <CompareRadarChart
              allPlayers={a.positionGroup}
              selectedPlayers={[a.stats!, b.stats!]}
              position={a.entry.player.position}
            />
          </div>
        </div>
      )}

      {/* Cross-position note */}
      {!samePosition && (
        <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3">
          <p className="text-xs text-amber-300">
            Comparing across positions ({a.entry.player.position} vs {b.entry.player.position}).
            Radar uses same-position percentiles; the head-to-head chart above and shared metrics below work across positions.
          </p>
        </div>
      )}

      {/* Side-by-side stats table */}
      {(a.stats || b.stats) && (
        <div>
          <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
            Stat Comparison {!samePosition && "(Shared Metrics)"}
          </h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left text-slate-500 text-xs font-medium px-2 py-2">Stat</th>
                {players.map((p, i) => (
                  <th
                    key={p.entry.player.id}
                    className="text-right text-xs font-medium px-2 py-2"
                    style={{ color: PLAYER_TEXT_COLORS[i] }}
                  >
                    {p.entry.player.full_name.split(" ").pop()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-white/[0.04]">
                <td className="text-slate-500 px-2 py-1.5 text-xs">Team</td>
                {players.map((p) => (
                  <td key={p.entry.player.id} className="text-right text-slate-300 px-2 py-1.5 font-mono text-xs">
                    {p.entry.player.nfl_team}
                  </td>
                ))}
              </tr>
              <tr className="border-b border-white/[0.04]">
                <td className="text-slate-500 px-2 py-1.5 text-xs">GP</td>
                {players.map((p) => (
                  <td key={p.entry.player.id} className="text-right text-slate-300 px-2 py-1.5 font-mono text-xs">
                    {p.stats?.games_played ?? "-"}
                  </td>
                ))}
              </tr>
              {statRows.map((row) => {
                const vals = players.map((p) => (p.stats ? (p.stats[row.key] as number | null) : null));
                const validVals = vals.filter((v): v is number => v != null);
                const best = validVals.length > 0 ? Math.max(...validVals) : null;
                return (
                  <tr key={row.key} className="border-b border-white/[0.04]">
                    <td className="text-slate-500 px-2 py-1.5 text-xs whitespace-nowrap">{row.label}</td>
                    {vals.map((val, i) => {
                      const isBest = val != null && best != null && val === best && validVals.length > 1;
                      return (
                        <td
                          key={i}
                          className={`text-right px-2 py-1.5 font-mono text-xs ${
                            isBest ? "text-emerald-400 font-semibold" : "text-slate-300"
                          }`}
                        >
                          {row.format(val)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Two full analytics columns side by side */}
      <div className="pt-4 border-t border-white/5">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Full Breakdown
        </h4>
        <div className="grid grid-cols-2 gap-4">
          {players.map((p, i) => (
            <PlayerAnalyticsColumn
              key={p.entry.player.id}
              entry={p.entry}
              stats={p.stats}
              positionGroup={p.positionGroup}
              sparkline={p.sparkline}
              weekly={p.weekly}
              loading={loading}
              accentColor={PLAYER_TEXT_COLORS[i]}
              compact
            />
          ))}
        </div>
      </div>
    </div>
  );
}
