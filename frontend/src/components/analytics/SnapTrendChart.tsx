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
import {
  ABSENCE_LABEL,
  ABSENCE_MARK,
  absenceRuns,
  weekDomain,
  weekStatus,
  type WeekStatus,
} from "../../lib/weeklyTimeline";
import { absenceBands, weekTick } from "./absenceLayer";

interface Props {
  weeks: PlayerWeekly[];
}

interface ChartPoint {
  week: number;
  /** null for a week with no game, which breaks the line instead of bridging it. */
  snapPct: number | null;
  opponent: string;
  ppr: number | null;
  status: WeekStatus;
}

function CustomTooltip({ active, label, slots }: {
  active?: boolean;
  label?: string | number;
  slots: ChartPoint[];
}) {
  if (!active) return null;
  const week = typeof label === "number" ? label : Number(label);
  const d = slots.find((s) => s.week === week);
  if (!d) return null;

  return (
    <div className="bg-[#1a1d28] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-white text-sm font-medium">
        Week {d.week}
        {d.status === "bye" ? "" : ` vs ${d.opponent}`}
      </p>
      {d.snapPct != null ? (
        <div className="mt-1 space-y-0.5">
          <p className="text-slate-300 text-xs">
            Snap%: <span className="text-sky-300 font-mono">{d.snapPct.toFixed(1)}%</span>
          </p>
          <p className="text-slate-300 text-xs">
            PPR: <span className="text-sky-300 font-mono">{(d.ppr ?? 0).toFixed(1)}</span>
          </p>
        </div>
      ) : (
        <p
          className="text-xs mt-1"
          style={{ color: d.status === "missed" ? ABSENCE_MARK.missed : "#94a3b8" }}
        >
          {ABSENCE_LABEL[d.status === "played" ? "missed" : d.status]}
        </p>
      )}
    </div>
  );
}

export default function SnapTrendChart({ weeks }: Props) {
  // Every week of the season gets a slot. A week he didn't play carries a null
  // snap share, which keeps its place on the axis and breaks the line there.
  const chartData = useMemo<ChartPoint[]>(() => {
    return weeks.map((w) => {
      const status = weekStatus(w);
      const hasSnaps = status === "played" && w.snap_pct != null;
      return {
        week: w.week,
        snapPct: hasSnaps ? w.snap_pct! * 100 : null,
        opponent: w.opponent ?? "—",
        ppr: hasSnaps ? w.fantasy_points_ppr ?? 0 : null,
        status,
      };
    });
  }, [weeks]);

  const played = useMemo(() => chartData.filter((d) => d.snapPct != null), [chartData]);
  const runs = useMemo(() => absenceRuns(weeks), [weeks]);
  const [firstWeek, lastWeek] = useMemo(() => weekDomain(weeks), [weeks]);
  const statusByWeek = useMemo(
    () => new Map(chartData.map((d) => [d.week, d.status])),
    [chartData]
  );
  const weekTicks = useMemo(() => chartData.map((d) => d.week), [chartData]);

  // Regression over the games he played -- an absence is not a zero snap share.
  const trend = useMemo(() => {
    if (played.length < 2) return null;
    const n = played.length;
    const sumX = played.reduce((s, d) => s + d.week, 0);
    const sumY = played.reduce((s, d) => s + (d.snapPct as number), 0);
    const sumXY = played.reduce((s, d) => s + d.week * (d.snapPct as number), 0);
    const sumXX = played.reduce((s, d) => s + d.week * d.week, 0);
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
      startWeek: played[0].week,
      endWeek: played[played.length - 1].week,
      startY: slope * played[0].week + intercept,
      endY: slope * played[played.length - 1].week + intercept,
    };
  }, [played]);

  if (played.length < 2) return null;

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
          {/* Behind everything: the weeks he wasn't on the field. */}
          {absenceBands(runs)}

          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
          <XAxis
            dataKey="week"
            type="number"
            domain={[firstWeek - 0.5, lastWeek + 0.5]}
            ticks={weekTicks}
            allowDecimals={false}
            tick={weekTick(statusByWeek)}
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
          <Tooltip content={<CustomTooltip slots={chartData} />} cursor={false} />

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
            connectNulls={false}
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
