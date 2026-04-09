import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { PlayerWeekly } from "../../types";

/** A universally-available metric that can compare any two players, regardless of position */
interface H2HMetric {
  key: string;
  label: string;
  getValue: (w: PlayerWeekly) => number | null;
  format: (v: number) => string;
  domain?: [number, number];
  tickFormat?: (v: number) => string;
  /** Restrict to positions that actually track this stat */
  positions?: string[];
}

const pprPoints: H2HMetric = {
  key: "ppr",
  label: "PPR Pts",
  getValue: (w) => w.fantasy_points_ppr,
  format: (v) => v.toFixed(1),
};

const standardPoints: H2HMetric = {
  key: "standard",
  label: "Std Pts",
  getValue: (w) => w.fantasy_points,
  format: (v) => v.toFixed(1),
};

const snapPct: H2HMetric = {
  key: "snap_pct",
  label: "Snap %",
  getValue: (w) => (w.snap_pct != null ? w.snap_pct * 100 : null),
  format: (v) => `${v.toFixed(1)}%`,
  domain: [0, 100],
  tickFormat: (v) => `${v}%`,
};

const totalYards: H2HMetric = {
  key: "total_yards",
  label: "Total Yds",
  getValue: (w) => {
    const rush = w.rush_yards ?? 0;
    const rec = w.rec_yards ?? 0;
    const pass = w.pass_yards ?? 0;
    const total = rush + rec + pass;
    return total > 0 ? total : null;
  },
  format: (v) => String(Math.round(v)),
};

const totalTds: H2HMetric = {
  key: "total_tds",
  label: "TDs",
  getValue: (w) => {
    const rush = w.rush_tds ?? 0;
    const rec = w.rec_tds ?? 0;
    const pass = w.pass_tds ?? 0;
    const total = rush + rec + pass;
    return total > 0 ? total : null;
  },
  format: (v) => String(Math.round(v)),
};

const H2H_METRICS: H2HMetric[] = [pprPoints, standardPoints, snapPct, totalYards, totalTds];

const PLAYER_COLORS = ["#38bdf8", "#f59e0b"]; // sky, amber — match compare pills

interface ChartPoint {
  week: number;
  [playerName: string]: string | number | null;
}

function H2HTooltip({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint; value: number; name: string; color: string }>;
  metric: H2HMetric;
}) {
  if (!active || !payload?.length) return null;
  const week = payload[0].payload.week;
  return (
    <div className="bg-[#1a1d28] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-white text-sm font-medium mb-1">Week {week}</p>
      {payload.map((entry) => (
        <p key={entry.name} className="text-xs" style={{ color: entry.color }}>
          {entry.name}: <span className="font-mono">{metric.format(entry.value)}</span>
        </p>
      ))}
    </div>
  );
}

interface Props {
  weeksA: PlayerWeekly[];
  weeksB: PlayerWeekly[];
  nameA: string;
  nameB: string;
}

export default function HeadToHeadWeeklyChart({ weeksA, weeksB, nameA, nameB }: Props) {
  const [activeMetric, setActiveMetric] = useState<string>("ppr");
  const metric = H2H_METRICS.find((m) => m.key === activeMetric) ?? H2H_METRICS[0];

  // Merge both players' week data into a single array keyed by week number
  const chartData = useMemo<ChartPoint[]>(() => {
    const byWeek = new Map<number, ChartPoint>();

    const addWeeks = (weeks: PlayerWeekly[], playerName: string) => {
      for (const w of weeks) {
        const val = metric.getValue(w);
        if (val == null) continue;
        const existing = byWeek.get(w.week) ?? { week: w.week };
        existing[playerName] = val;
        byWeek.set(w.week, existing);
      }
    };

    addWeeks(weeksA, nameA);
    addWeeks(weeksB, nameB);

    return [...byWeek.values()].sort((a, b) => (a.week as number) - (b.week as number));
  }, [weeksA, weeksB, nameA, nameB, metric]);

  const hasData = chartData.length > 0;

  return (
    <div>
      {/* Metric tabs */}
      <div className="flex gap-1 flex-wrap mb-2">
        {H2H_METRICS.map((m) => (
          <button
            key={m.key}
            onClick={() => setActiveMetric(m.key)}
            className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
              activeMetric === m.key
                ? "bg-sky-600 text-white"
                : "bg-white/5 text-slate-400 hover:bg-white/10"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="flex items-center justify-center h-[180px] text-xs text-slate-500">
          No weekly data available for {metric.label}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="week"
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              domain={metric.domain ?? ["auto", "auto"]}
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              tickFormatter={metric.tickFormat}
            />
            <Tooltip content={<H2HTooltip metric={metric} />} cursor={false} />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#94a3b8", paddingTop: 4 }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey={nameA}
              stroke={PLAYER_COLORS[0]}
              strokeWidth={2}
              dot={{ r: 3, fill: PLAYER_COLORS[0], strokeWidth: 0 }}
              activeDot={{ r: 5, fill: PLAYER_COLORS[0], strokeWidth: 0 }}
              connectNulls
              animationDuration={400}
            />
            <Line
              type="monotone"
              dataKey={nameB}
              stroke={PLAYER_COLORS[1]}
              strokeWidth={2}
              dot={{ r: 3, fill: PLAYER_COLORS[1], strokeWidth: 0 }}
              activeDot={{ r: 5, fill: PLAYER_COLORS[1], strokeWidth: 0 }}
              connectNulls
              animationDuration={400}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
