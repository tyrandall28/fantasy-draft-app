import { useMemo } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Legend,
  Tooltip,
} from "recharts";
import type { PlayerDerivedStats } from "../../types";
import { COMPARE_PLAYER_COLORS } from "../../lib/compareColors";

/** Defines an axis on the radar chart */
interface RadarMetric {
  key: keyof PlayerDerivedStats;
  label: string;
  /** Higher is better? (default true). If false, percentile is inverted. */
  higherIsBetter?: boolean;
}

const RADAR_METRICS: Record<string, RadarMetric[]> = {
  QB: [
    { key: "ppr_per_game", label: "PPR/G" },
    { key: "pass_tds_per_game", label: "Pass TD/G" },
    { key: "pass_yards_per_game", label: "Pass Yds/G" },
    { key: "rush_tds_per_game", label: "Rush TD/G" },
    { key: "rush_yards_per_game", label: "Rush Yds/G" },
    { key: "completion_pct", label: "Comp%" },
    { key: "cpoe", label: "CPOE" },
    { key: "pass_epa_per_game", label: "EPA/G" },
  ],
  RB: [
    { key: "ppr_per_game", label: "PPR/G" },
    { key: "rush_yards_per_game", label: "Rush Yds/G" },
    { key: "yards_per_carry", label: "Yds/Carry" },
    { key: "tds_per_game", label: "TDs/G" },
    { key: "targets_per_game", label: "Tgt/G" },
    { key: "catch_rate", label: "Catch%" },
    { key: "snap_pct", label: "Snap%" },
  ],
  WR: [
    { key: "ppr_per_game", label: "PPR/G" },
    { key: "rec_yards_per_game", label: "Rec Yds/G" },
    { key: "targets_per_game", label: "Tgt/G" },
    { key: "yards_per_target", label: "Yds/Tgt" },
    { key: "catch_rate", label: "Catch%" },
    { key: "target_share", label: "Tgt Share" },
    { key: "tds_per_game", label: "TDs/G" },
  ],
  TE: [
    { key: "ppr_per_game", label: "PPR/G" },
    { key: "rec_yards_per_game", label: "Rec Yds/G" },
    { key: "targets_per_game", label: "Tgt/G" },
    { key: "catch_rate", label: "Catch%" },
    { key: "target_share", label: "Tgt Share" },
    { key: "tds_per_game", label: "TDs/G" },
    { key: "snap_pct", label: "Snap%" },
  ],
  K: [
    { key: "ppr_per_game", label: "PPR/G" },
    { key: "fg_pct", label: "FG%" },
    { key: "fg_made_per_game", label: "FG/G" },
    { key: "fg_long", label: "Long FG" },
    { key: "xp_pct", label: "XP%" },
  ],
};

const PLAYER_COLORS = COMPARE_PLAYER_COLORS;

/** Compute percentile (0-100) of a value within a sorted ascending array */
function percentileOf(sortedVals: number[], value: number): number {
  if (sortedVals.length === 0) return 50;
  if (sortedVals.length === 1) return 50;
  let below = 0;
  for (const v of sortedVals) {
    if (v < value) below++;
    else break;
  }
  return Math.round((below / (sortedVals.length - 1)) * 100);
}

interface RadarDataPoint {
  metric: string;
  fullMark: 100;
  [playerName: string]: string | number;
}

interface Props {
  /** All players in the position group (for percentile computation) */
  allPlayers: PlayerDerivedStats[];
  /** Selected players to compare (2-3) */
  selectedPlayers: PlayerDerivedStats[];
  position: string;
}

function RadarTooltipContent({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="panel-raised px-3 py-2 shadow-xl">
      <p className="text-chalk text-sm font-medium mb-1">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: <span className="font-mono">{entry.value}th</span>
        </p>
      ))}
    </div>
  );
}

export default function CompareRadarChart({ allPlayers, selectedPlayers, position }: Props) {
  const metrics = RADAR_METRICS[position] ?? RADAR_METRICS["QB"];

  // Pre-compute sorted arrays for each metric (for percentile lookups)
  const sortedByMetric = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const m of metrics) {
      const vals = allPlayers
        .map((p) => p[m.key] as number | null)
        .filter((v): v is number => v != null)
        .sort((a, b) => a - b);
      map.set(m.key, vals);
    }
    return map;
  }, [allPlayers, metrics]);

  // Build radar data: one entry per metric, with each selected player's percentile
  const radarData = useMemo<RadarDataPoint[]>(() => {
    return metrics.map((m) => {
      const sorted = sortedByMetric.get(m.key) ?? [];
      const point: RadarDataPoint = { metric: m.label, fullMark: 100 };
      for (const player of selectedPlayers) {
        const raw = player[m.key] as number | null;
        let pct = raw != null ? percentileOf(sorted, raw) : 0;
        if (m.higherIsBetter === false) pct = 100 - pct;
        point[player.full_name] = pct;
      }
      return point;
    });
  }, [metrics, sortedByMetric, selectedPlayers]);

  if (selectedPlayers.length < 2) return null;

  return (
    <ResponsiveContainer width="100%" height={420}>
      <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="75%">
        <PolarGrid stroke="rgba(237,234,227,0.09)" />
        <PolarAngleAxis
          dataKey="metric"
          tick={{ fill: "#9a968c", fontSize: 12 }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tick={{ fill: "#6b6862", fontSize: 9 }}
          tickFormatter={(v: number) => `${v}`}
          axisLine={false}
        />
        <Tooltip content={<RadarTooltipContent />} />
        {selectedPlayers.map((player, i) => (
          <Radar
            key={player.player_id}
            name={player.full_name}
            dataKey={player.full_name}
            stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]}
            fill={PLAYER_COLORS[i % PLAYER_COLORS.length]}
            fillOpacity={0.15}
            strokeWidth={2}
            animationDuration={500}
          />
        ))}
        <Legend
          wrapperStyle={{ fontSize: 13, color: "#edeae3" }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
