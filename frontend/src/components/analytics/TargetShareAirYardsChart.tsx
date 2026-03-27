import { useEffect, useMemo, useState } from "react";
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Label,
} from "recharts";
import { usePlayerCard } from "../../context/PlayerCardContext";
import type { PlayerDerivedStats } from "../../types";

interface Props {
  data: PlayerDerivedStats[];
  position: string;
}

interface ScatterPoint {
  x: number;
  y: number;
  name: string;
  team: string;
  playerId: number;
  gp: number;
  pprPerGame: number;
  recYards: number;
}

const POSITION_COLORS: Record<string, string> = {
  WR: "#f59e0b", // amber
  TE: "#a78bfa", // violet
};

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ScatterPoint }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a1d28] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-white font-medium text-sm">{d.name}</p>
      <p className="text-slate-400 text-xs">{d.team} &middot; {d.gp} games</p>
      <div className="mt-1.5 space-y-0.5">
        <p className="text-slate-300 text-xs">
          Target Share: <span className="text-sky-300 font-mono">{d.x.toFixed(1)}%</span>
        </p>
        <p className="text-slate-300 text-xs">
          Air Yards/G: <span className="text-sky-300 font-mono">{d.y.toFixed(1)}</span>
        </p>
        <p className="text-slate-300 text-xs">
          Rec Yards/G: <span className="text-sky-300 font-mono">{d.recYards.toFixed(1)}</span>
        </p>
        <p className="text-slate-300 text-xs">
          PPR/Game: <span className="text-sky-300 font-mono">{d.pprPerGame.toFixed(1)}</span>
        </p>
      </div>
    </div>
  );
}

export default function TargetShareAirYardsChart({ data, position }: Props) {
  const { openPlayerCard } = usePlayerCard();

  const scatterData = useMemo<ScatterPoint[]>(() => {
    return data
      .filter(
        (p) =>
          p.games_played >= 6 &&
          p.target_share != null &&
          p.air_yards_per_game != null
      )
      .map((p) => ({
        x: p.target_share!,
        y: p.air_yards_per_game!,
        name: p.full_name,
        team: p.nfl_team,
        playerId: p.player_id,
        gp: p.games_played,
        pprPerGame: p.ppr_per_game ?? 0,
        recYards: p.rec_yards_per_game ?? 0,
      }));
  }, [data]);

  // Median lines for quadrants
  const medianX = useMemo(() => {
    if (scatterData.length === 0) return 0;
    const sorted = [...scatterData].sort((a, b) => a.x - b.x);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1].x + sorted[mid].x) / 2
      : sorted[mid].x;
  }, [scatterData]);

  const medianY = useMemo(() => {
    if (scatterData.length === 0) return 0;
    const sorted = [...scatterData].sort((a, b) => a.y - b.y);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1].y + sorted[mid].y) / 2
      : sorted[mid].y;
  }, [scatterData]);

  const color = POSITION_COLORS[position] || "#f59e0b";

  // Label animation (same pattern as BoomBustChart)
  const DOT_ANIMATION_MS = 500;
  const [showLabels, setShowLabels] = useState(false);
  useEffect(() => {
    setShowLabels(false);
    const timer = setTimeout(() => setShowLabels(true), DOT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [data, position]);

  const getLabel = (fullName: string) => {
    const parts = fullName.split(" ");
    if (parts.length <= 1) return fullName;
    const lastName = parts.slice(1).join(" ");
    return lastName.length > 12 ? lastName.slice(0, 11) + "." : lastName;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderDot = (props: any) => {
    const { cx, cy, payload } = props;
    if (cx == null || cy == null) return null;
    return (
      <g>
        <circle cx={cx} cy={cy} r={5} fill={color} fillOpacity={0.75} />
        {showLabels && (
          <text
            x={cx + 8}
            y={cy + 3}
            fill="#94a3b8"
            fontSize={9}
            fontFamily="system-ui, sans-serif"
            opacity={0}
          >
            {getLabel(payload.name)}
            <animate attributeName="opacity" from="0" to="1" dur="0.4s" fill="freeze" />
          </text>
        )}
      </g>
    );
  };

  if (scatterData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[450px] text-slate-500">
        No target share / air yards data available for {position}s.
      </div>
    );
  }

  return (
    <div>
      {/* Quadrant legend */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 mb-4 px-2">
        <span className="text-xs text-slate-500">
          <span className="text-emerald-400 font-medium">Top-right:</span> Alpha — primary deep threat with volume
        </span>
        <span className="text-xs text-slate-500">
          <span className="text-amber-400 font-medium">Bottom-right:</span> Possession — high volume, shorter routes
        </span>
        <span className="text-xs text-slate-500">
          <span className="text-sky-400 font-medium">Top-left:</span> Deep Threat — low volume, big play potential
        </span>
        <span className="text-xs text-slate-500">
          <span className="text-slate-400 font-medium">Bottom-left:</span> Depth — limited opportunity
        </span>
      </div>

      <ResponsiveContainer width="100%" height={450}>
        <ScatterChart margin={{ top: 10, right: 30, bottom: 25, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis
            type="number"
            dataKey="x"
            name="Target Share"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
            tickFormatter={(v: number) => `${v}%`}
          >
            <Label
              value="Target Share %"
              position="bottom"
              offset={10}
              style={{ fill: "#64748b", fontSize: 13 }}
            />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            name="Air Yards/G"
            tick={{ fill: "#94a3b8", fontSize: 12 }}
            axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
            tickLine={{ stroke: "rgba(255,255,255,0.1)" }}
          >
            <Label
              value="Air Yards / Game"
              angle={-90}
              position="insideLeft"
              offset={5}
              style={{ fill: "#64748b", fontSize: 13 }}
            />
          </YAxis>
          <Tooltip content={<CustomTooltip />} cursor={false} />

          {/* Quadrant dividers */}
          <ReferenceLine
            x={medianX}
            stroke="rgba(255,255,255,0.12)"
            strokeDasharray="6 4"
          />
          <ReferenceLine
            y={medianY}
            stroke="rgba(255,255,255,0.12)"
            strokeDasharray="6 4"
          />

          <Scatter
            data={scatterData}
            fill={color}
            fillOpacity={0.7}
            strokeWidth={0}
            shape={renderDot}
            animationDuration={DOT_ANIMATION_MS}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            onClick={(data: any) => {
              if (data?.playerId) openPlayerCard(data.playerId);
            }}
            cursor="pointer"
          />
        </ScatterChart>
      </ResponsiveContainer>

      <p className="text-xs text-slate-500 mt-2 px-2">
        {scatterData.length} players shown (min 6 games). Click a dot to view player details.
      </p>
    </div>
  );
}
