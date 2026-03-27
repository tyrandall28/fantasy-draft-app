import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { PlayerWeekly } from "../../types";

/** Defines a single trendable metric */
export interface TrendMetric {
  key: string;
  label: string;
  /** Extract the value from a weekly row. Return null to skip that week. */
  getValue: (w: PlayerWeekly) => number | null;
  /** Format the value for display (tooltip, avg label) */
  format: (v: number) => string;
  /** Y-axis domain. Defaults to auto. */
  domain?: [number, number];
  /** Y-axis tick formatter */
  tickFormat?: (v: number) => string;
  /** Threshold for slope to count as rising/declining. Default 0.5. */
  slopeThreshold?: number;
  /** Line color */
  color?: string;
}

// ---------- Metric definitions ----------

const snapPct: TrendMetric = {
  key: "snap_pct",
  label: "Snap %",
  getValue: (w) => w.snap_pct != null ? w.snap_pct * 100 : null,
  format: (v) => `${v.toFixed(1)}%`,
  domain: [0, 100],
  tickFormat: (v) => `${v}%`,
  slopeThreshold: 0.5,
};

const pprPoints: TrendMetric = {
  key: "ppr",
  label: "PPR Pts",
  getValue: (w) => w.fantasy_points_ppr,
  format: (v) => v.toFixed(1),
  slopeThreshold: 0.3,
  color: "#a78bfa", // violet
};

const targets: TrendMetric = {
  key: "targets",
  label: "Targets",
  getValue: (w) => w.targets,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 0.15,
  color: "#f59e0b", // amber
};

const targetShare: TrendMetric = {
  key: "target_share",
  label: "Tgt Share",
  getValue: (w) => w.target_share != null ? w.target_share * 100 : null,
  format: (v) => `${v.toFixed(1)}%`,
  domain: [0, 50],
  tickFormat: (v) => `${v}%`,
  slopeThreshold: 0.3,
  color: "#fb7185", // rose
};

const rushYards: TrendMetric = {
  key: "rush_yards",
  label: "Rush Yds",
  getValue: (w) => w.rush_yards,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 1,
  color: "#34d399", // emerald
};

const recYards: TrendMetric = {
  key: "rec_yards",
  label: "Rec Yds",
  getValue: (w) => w.rec_yards,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 1,
  color: "#38bdf8", // sky
};

const passYards: TrendMetric = {
  key: "pass_yards",
  label: "Pass Yds",
  getValue: (w) => w.pass_yards,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 3,
  color: "#f87171", // red
};

const receptions: TrendMetric = {
  key: "receptions",
  label: "Receptions",
  getValue: (w) => w.receptions,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 0.1,
  color: "#22d3ee", // cyan
};

/** Get available metrics for a position */
export function getMetricsForPosition(position: string): TrendMetric[] {
  switch (position) {
    case "QB":
      return [pprPoints, passYards, rushYards, snapPct];
    case "RB":
      return [pprPoints, rushYards, targets, snapPct];
    case "WR":
      return [pprPoints, targets, targetShare, recYards, snapPct];
    case "TE":
      return [pprPoints, targets, targetShare, recYards, receptions, snapPct];
    case "K":
      return [pprPoints];
    default:
      return [pprPoints, snapPct];
  }
}

// ---------- Chart component ----------

interface ChartPoint {
  week: number;
  value: number;
  opponent: string;
}

function ChartTooltip({ active, payload, metric }: {
  active?: boolean;
  payload?: Array<{ payload: ChartPoint }>;
  metric: TrendMetric;
}) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a1d28] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-white text-sm font-medium">Week {d.week} vs {d.opponent}</p>
      <p className="text-slate-300 text-xs mt-1">
        {metric.label}: <span className="text-sky-300 font-mono">{metric.format(d.value)}</span>
      </p>
    </div>
  );
}

interface Props {
  weeks: PlayerWeekly[];
  position: string;
}

export default function WeeklyTrendChart({ weeks, position }: Props) {
  const metrics = useMemo(() => getMetricsForPosition(position), [position]);
  const [activeMetric, setActiveMetric] = useState<string>(metrics[0]?.key ?? "ppr");

  const metric = metrics.find((m) => m.key === activeMetric) ?? metrics[0];

  const chartData = useMemo<ChartPoint[]>(() => {
    if (!metric) return [];
    return weeks
      .map((w) => {
        const val = metric.getValue(w);
        if (val == null) return null;
        return { week: w.week, value: val, opponent: w.opponent ?? "—" };
      })
      .filter((d): d is ChartPoint => d !== null);
  }, [weeks, metric]);

  // Linear regression
  const trend = useMemo(() => {
    if (chartData.length < 2) return null;
    const n = chartData.length;
    const sumX = chartData.reduce((s, d) => s + d.week, 0);
    const sumY = chartData.reduce((s, d) => s + d.value, 0);
    const sumXY = chartData.reduce((s, d) => s + d.week * d.value, 0);
    const sumXX = chartData.reduce((s, d) => s + d.week * d.week, 0);
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const avg = sumY / n;
    const threshold = metric?.slopeThreshold ?? 0.5;

    let color = "#64748b";
    let label = "Flat";
    if (slope > threshold) { color = "#34d399"; label = "Rising"; }
    if (slope < -threshold) { color = "#f87171"; label = "Declining"; }

    return {
      color,
      label,
      avg: Math.round(avg * 10) / 10,
      startWeek: chartData[0].week,
      endWeek: chartData[chartData.length - 1].week,
      startY: slope * chartData[0].week + intercept,
      endY: slope * chartData[chartData.length - 1].week + intercept,
    };
  }, [chartData, metric]);

  if (!metric || metrics.length === 0) return null;
  const lineColor = metric.color ?? "#38bdf8";

  return (
    <div className="mb-3">
      {/* Metric tabs */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1 flex-wrap">
          {metrics.map((m) => (
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
        {trend && (
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-[11px] text-slate-500">Avg: {metric.format(trend.avg)}</span>
            <span className="text-[11px] font-medium" style={{ color: trend.color }}>
              {trend.label}
            </span>
          </div>
        )}
      </div>

      {chartData.length < 2 ? (
        <div className="flex items-center justify-center h-[120px] text-xs text-slate-500">
          Not enough data for {metric.label} trend
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: -15 }}>
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
            <Tooltip content={<ChartTooltip metric={metric} />} cursor={false} />

            {trend && (
              <ReferenceLine
                y={trend.avg}
                stroke="rgba(255,255,255,0.1)"
                strokeDasharray="4 4"
              />
            )}

            <Line
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={2}
              dot={{ r: 3, fill: lineColor, strokeWidth: 0 }}
              activeDot={{ r: 5, fill: lineColor, strokeWidth: 0 }}
              animationDuration={400}
            />

            {trend && (
              <ReferenceLine
                segment={[
                  { x: trend.startWeek, y: trend.startY },
                  { x: trend.endWeek, y: trend.endY },
                ]}
                stroke={trend.color}
                strokeWidth={2}
                strokeDasharray="6 3"
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
