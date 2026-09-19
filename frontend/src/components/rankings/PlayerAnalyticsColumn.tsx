import { useMemo } from "react";
import Sparkline from "../analytics/Sparkline";
import WeeklyTrendChart from "../analytics/WeeklyTrendChart";
import PositionDataNotice from "../analytics/PositionDataNotice";
import { hasFantasyPoints, positionNotice } from "../../lib/positionData";
import type {
  PlayerDerivedStats,
  PlayerWeekly,
  SparklinePoint,
  UserRankingEntry,
} from "../../types";
import { positionBadge } from "../../lib/positionColors";


interface StatDef {
  key: keyof PlayerDerivedStats;
  label: string;
  format: (v: number | null) => string;
}

const fmt1 = (v: number | null) => (v != null ? v.toFixed(1) : "-");
const fmt2 = (v: number | null) => (v != null ? v.toFixed(2) : "-");
const fmtPct = (v: number | null) => (v != null ? `${v.toFixed(1)}%` : "-");

const KEY_STATS: Record<string, StatDef[]> = {
  QB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "pass_tds_per_game", label: "Pass TD/G", format: fmt2 },
    { key: "pass_yards_per_game", label: "Pass Y/G", format: fmt1 },
    { key: "rush_tds_per_game", label: "Rush TD/G", format: fmt2 },
  ],
  RB: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rush_yards_per_game", label: "Rush Y/G", format: fmt1 },
    { key: "yards_per_carry", label: "YPC", format: fmt2 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
  ],
  WR: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rec_yards_per_game", label: "Rec Y/G", format: fmt1 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "target_share", label: "Tgt Share", format: fmtPct },
  ],
  TE: [
    { key: "ppr_per_game", label: "PPR/G", format: fmt1 },
    { key: "rec_yards_per_game", label: "Rec Y/G", format: fmt1 },
    { key: "targets_per_game", label: "Tgt/G", format: fmt1 },
    { key: "catch_rate", label: "Catch%", format: fmtPct },
  ],
  // No PPR/G here: nflverse doesn't score kicking, so it would always be 0.
  K: [
    { key: "fg_made_per_game", label: "FG/G", format: fmt2 },
    { key: "fg_pct", label: "FG%", format: fmtPct },
    { key: "fg_long", label: "Long FG", format: fmt1 },
    { key: "xp_pct", label: "XP%", format: fmtPct },
  ],
};

/** Compute percentile (0-100) of a value within a sorted ascending array */
function percentileOf(sortedVals: number[], value: number): number {
  if (sortedVals.length <= 1) return 50;
  let below = 0;
  for (const v of sortedVals) {
    if (v < value) below++;
    else break;
  }
  return Math.round((below / (sortedVals.length - 1)) * 100);
}

interface Props {
  entry: UserRankingEntry;
  stats: PlayerDerivedStats | null;
  positionGroup: PlayerDerivedStats[];
  sparkline: SparklinePoint[];
  weekly: PlayerWeekly[];
  loading: boolean;
  /** Color accent for the header (used in compare mode) */
  accentColor?: string;
  /** Compact mode reduces some spacing for side-by-side layout */
  compact?: boolean;
}

/**
 * Full analytics column for a single player. Used by both SinglePlayerView
 * and ComparePlayersView (two of them side-by-side).
 */
export default function PlayerAnalyticsColumn({
  entry,
  stats,
  positionGroup,
  sparkline,
  weekly,
  loading,
  accentColor,
  compact = false,
}: Props) {
  const position = entry.player.position;
  const notice = positionNotice(position);
  // Fall back to the WR layout only for positions we simply don't have a
  // bespoke stat set for -- never for one with no data, which would otherwise
  // render a defense with receiving labels and a column of dashes.
  const statDefs = KEY_STATS[position] ?? (notice?.level === "none" ? [] : KEY_STATS["WR"]);

  const sortedByMetric = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const def of statDefs) {
      const vals = positionGroup
        .map((p) => p[def.key] as number | null)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      map.set(def.key, vals);
    }
    return map;
  }, [positionGroup, statDefs]);

  const posColor = positionBadge(position);
  const gridCols = compact ? "grid-cols-2" : "grid-cols-2";

  return (
    <div className={compact ? "space-y-3" : "space-y-5"}>
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className={`badge ${posColor}`}>
            {position}
          </span>
          <h3
            className={`${compact ? "text-sm" : "text-lg"} font-bold truncate`}
            style={accentColor ? { color: accentColor } : { color: "var(--color-chalk)" }}
          >
            {entry.player.full_name}
          </h3>
        </div>
        <p className="text-xs text-chalk-mut">
          {entry.player.nfl_team}
          {entry.player.bye_week ? ` · Bye ${entry.player.bye_week}` : ""} · Rank #{entry.rank}
        </p>
      </div>

      {/* Why this position's analytics are thin or absent */}
      {notice && <PositionDataNotice notice={notice} variant="compact" />}

      {/* Loading / no-stats states */}
      {!stats && !loading && !notice && (
        <div className="panel-inset p-3 text-center">
          <p className="text-xs text-chalk-mut">No season stats available.</p>
        </div>
      )}
      {loading && !stats && (
        <div className="flex items-center justify-center py-4">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent" />
        </div>
      )}

      {/* Key stats grid with percentile bars */}
      {stats && (
        <div>
          <h4 className="text-[10px] font-semibold text-chalk-dim uppercase tracking-wide mb-2">
            Key Stats ({stats.season})
          </h4>
          <div className={`grid ${gridCols} gap-2`}>
            {statDefs.map((def) => {
              const raw = stats[def.key] as number | null;
              const sorted = sortedByMetric.get(def.key) ?? [];
              const pct = raw != null ? percentileOf(sorted, raw) : 0;
              const barColor =
                pct >= 75
                  ? "bg-rise"
                  : pct >= 50
                  ? "bg-accent"
                  : pct >= 25
                  ? "bg-caution"
                  : "bg-fall";
              return (
                <div
                  key={def.key}
                  className="panel-inset p-2"
                >
                  <p className="text-[9px] uppercase tracking-wide text-chalk-mut">{def.label}</p>
                  <p className={`${compact ? "text-sm" : "text-lg"} font-mono font-semibold text-chalk`}>
                    {def.format(raw)}
                  </p>
                  <div className="mt-1 flex items-center gap-1">
                    <div className="flex-1 h-1 bg-ink-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${barColor} rounded-full transition-all duration-500`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[9px] text-chalk-mut font-mono w-5 text-right">
                      {pct}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Career sparkline. PPR-based, so skip it for positions without fantasy
          scoring -- it would just draw a flat line at zero. */}
      {sparkline.length >= 2 && hasFantasyPoints(position) && (
        <div>
          <h4 className="text-[10px] font-semibold text-chalk-dim uppercase tracking-wide mb-1.5">
            Career Trend (PPR/G)
          </h4>
          <div className="panel-inset p-2.5 flex items-center gap-3">
            <Sparkline data={sparkline} width={compact ? 140 : 200} height={36} />
            <div className="flex gap-2 text-xs text-chalk-mut flex-wrap">
              {sparkline.map((s) => (
                <div key={s.season} className="text-center">
                  <p className="text-[9px] text-chalk-mut">'{String(s.season).slice(-2)}</p>
                  <p className="font-mono text-[11px] text-chalk-dim">
                    {s.ppr_per_game != null ? s.ppr_per_game.toFixed(1) : "-"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Weekly trend chart */}
      {weekly.length > 0 && position !== "DST" && (
        <div>
          <h4 className="text-[10px] font-semibold text-chalk-dim uppercase tracking-wide mb-1.5">
            Weekly Trend
          </h4>
          <WeeklyTrendChart weeks={weekly} position={position} />
        </div>
      )}
    </div>
  );
}
