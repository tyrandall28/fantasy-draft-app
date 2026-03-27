import { useMemo } from "react";
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

interface Props {
  weeks: PlayerWeekly[];
}

interface ChartPoint {
  week: number;
  snapPct: number;
  opponent: string;
  ppr: number;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ChartPoint }> }) {
  if (!active || !payload?.[0]) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-[#1a1d28] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-white text-sm font-medium">Week {d.week} vs {d.opponent}</p>
      <div className="mt-1 space-y-0.5">
        <p className="text-slate-300 text-xs">
          Snap%: <span className="text-sky-300 font-mono">{d.snapPct.toFixed(1)}%</span>
        </p>
        <p className="text-slate-300 text-xs">
          PPR: <span className="text-sky-300 font-mono">{d.ppr.toFixed(1)}</span>
        </p>
      </div>
    </div>
  );
}

export default function SnapTrendChart({ weeks }: Props) {
  const chartData = useMemo<ChartPoint[]>(() => {
    return weeks
      .filter((w) => w.snap_pct != null)
      .map((w) => ({
        week: w.week,
        snapPct: (w.snap_pct! * 100),
        opponent: w.opponent ?? "—",
        ppr: w.fantasy_points_ppr ?? 0,
      }));
  }, [weeks]);

  // Compute linear regression for trend line
  const trend = useMemo(() => {
    if (chartData.length < 2) return null;
    const n = chartData.length;
    const sumX = chartData.reduce((s, d) => s + d.week, 0);
    const sumY = chartData.reduce((s, d) => s + d.snapPct, 0);
    const sumXY = chartData.reduce((s, d) => s + d.week * d.snapPct, 0);
    const sumXX = chartData.reduce((s, d) => s + d.week * d.week, 0);
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const avgPct = sumY / n;

    // Trend direction: > 0.5 per week = rising, < -0.5 = falling
    let color = "#64748b"; // gray (flat)
    let label = "Flat";
    if (slope > 0.5) { color = "#34d399"; label = "Rising"; }    // emerald
    if (slope < -0.5) { color = "#f87171"; label = "Declining"; } // red

    return {
      slope,
      intercept,
      color,
      label,
      avgPct: Math.round(avgPct * 10) / 10,
      startWeek: chartData[0].week,
      endWeek: chartData[chartData.length - 1].week,
      startY: slope * chartData[0].week + intercept,
      endY: slope * chartData[chartData.length - 1].week + intercept,
    };
  }, [chartData]);

  if (chartData.length < 2) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-medium text-slate-400 uppercase tracking-wide">Snap % Trend</h3>
        {trend && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Avg: {trend.avgPct}%</span>
            <span className="text-xs font-medium" style={{ color: trend.color }}>
              {trend.label}
            </span>
          </div>
        )}
      </div>
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
            domain={[0, 100]}
            tick={{ fill: "#64748b", fontSize: 10 }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip content={<CustomTooltip />} cursor={false} />

          {/* Average line */}
          {trend && (
            <ReferenceLine
              y={trend.avgPct}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="4 4"
            />
          )}

          {/* Actual snap % line */}
          <Line
            type="monotone"
            dataKey="snapPct"
            stroke="#38bdf8"
            strokeWidth={2}
            dot={{ r: 3, fill: "#38bdf8", strokeWidth: 0 }}
            activeDot={{ r: 5, fill: "#38bdf8", strokeWidth: 0 }}
            animationDuration={400}
          />

          {/* Trend line overlay */}
          {trend && (
            <ReferenceLine
              segment={[
                { x: trend.startWeek, y: Math.max(0, Math.min(100, trend.startY)) },
                { x: trend.endWeek, y: Math.max(0, Math.min(100, trend.endY)) },
              ]}
              stroke={trend.color}
              strokeWidth={2}
              strokeDasharray="6 3"
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
