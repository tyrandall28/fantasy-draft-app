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
import {
  ABSENCE_LABEL,
  ABSENCE_MARK,
  absenceCounts,
  absenceRuns,
  weekDomain,
  weekStatus,
  type WeekStatus,
} from "../../lib/weeklyTimeline";
import { absenceBands, weekTick } from "./absenceLayer";

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
};

const targets: TrendMetric = {
  key: "targets",
  label: "Targets",
  getValue: (w) => w.targets,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 0.15,
};

const targetShare: TrendMetric = {
  key: "target_share",
  label: "Tgt Share",
  getValue: (w) => w.target_share != null ? w.target_share * 100 : null,
  format: (v) => `${v.toFixed(1)}%`,
  domain: [0, 50],
  tickFormat: (v) => `${v}%`,
  slopeThreshold: 0.3,
};

const rushYards: TrendMetric = {
  key: "rush_yards",
  label: "Rush Yds",
  getValue: (w) => w.rush_yards,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 1,
};

const recYards: TrendMetric = {
  key: "rec_yards",
  label: "Rec Yds",
  getValue: (w) => w.rec_yards,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 1,
};

const passYards: TrendMetric = {
  key: "pass_yards",
  label: "Pass Yds",
  getValue: (w) => w.pass_yards,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 3,
};

const receptions: TrendMetric = {
  key: "receptions",
  label: "Receptions",
  getValue: (w) => w.receptions,
  format: (v) => String(Math.round(v)),
  slopeThreshold: 0.1,
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
  /** null for a week with no game, which breaks the line instead of bridging it. */
  value: number | null;
  opponent: string;
  status: WeekStatus;
}

function ChartTooltip({ active, label, slots, metric }: {
  active?: boolean;
  label?: string | number;
  slots: ChartPoint[];
  metric: TrendMetric;
}) {
  if (!active) return null;
  const week = typeof label === "number" ? label : Number(label);
  const d = slots.find((s) => s.week === week);
  if (!d) return null;

  return (
    <div className="bg-ink-700 border border-ink-600 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-chalk text-sm font-medium">
        Week {d.week}
        {d.status === "bye" ? "" : ` vs ${d.opponent}`}
      </p>
      {d.value != null ? (
        <p className="text-chalk-dim text-xs mt-1">
          {metric.label}: <span className="text-chalk stat-num">{metric.format(d.value)}</span>
        </p>
      ) : (
        <p
          className="text-xs mt-1"
          style={{ color: d.status === "missed" ? ABSENCE_MARK.missed : "var(--color-chalk-dim)" }}
        >
          {ABSENCE_LABEL[d.status === "played" ? "missed" : d.status]}
        </p>
      )}
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

  // Every week of the season gets a slot. A week he didn't play carries a null
  // value, which keeps its place on the axis and breaks the line there.
  const chartData = useMemo<ChartPoint[]>(() => {
    if (!metric) return [];
    return weeks.map((w) => {
      const status = weekStatus(w);
      return {
        week: w.week,
        value: status === "played" ? metric.getValue(w) : null,
        opponent: w.opponent ?? "—",
        status,
      };
    });
  }, [weeks, metric]);

  const played = useMemo(() => chartData.filter((d) => d.value != null), [chartData]);
  const runs = useMemo(() => absenceRuns(weeks), [weeks]);
  const counts = useMemo(() => absenceCounts(weeks), [weeks]);
  const [firstWeek, lastWeek] = useMemo(() => weekDomain(weeks), [weeks]);
  const statusByWeek = useMemo(
    () => new Map(chartData.map((d) => [d.week, d.status])),
    [chartData]
  );
  const weekTicks = useMemo(() => chartData.map((d) => d.week), [chartData]);

  // Linear regression over the games he actually played -- an absence is not a
  // zero, and averaging one in would drag the trend down for weeks he never had
  // a chance to score in.
  const trend = useMemo(() => {
    if (played.length < 2) return null;
    const n = played.length;
    const sumX = played.reduce((s, d) => s + d.week, 0);
    const sumY = played.reduce((s, d) => s + (d.value as number), 0);
    const sumXY = played.reduce((s, d) => s + d.week * (d.value as number), 0);
    const sumXX = played.reduce((s, d) => s + d.week * d.week, 0);
    const denom = n * sumXX - sumX * sumX;
    if (denom === 0) return null;
    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;
    const avg = sumY / n;
    const threshold = metric?.slopeThreshold ?? 0.5;

    let color = "var(--color-chalk-mut)";
    let label = "Flat";
    if (slope > threshold) { color = "var(--color-rise)"; label = "Rising"; }
    if (slope < -threshold) { color = "var(--color-fall)"; label = "Declining"; }

    return {
      color,
      label,
      avg: Math.round(avg * 10) / 10,
      startWeek: played[0].week,
      endWeek: played[played.length - 1].week,
      startY: slope * played[0].week + intercept,
      endY: slope * played[played.length - 1].week + intercept,
    };
  }, [played, metric]);

  if (!metric || metrics.length === 0) return null;
  // Accent, not a per-metric hue: there is only ever one series on this chart,
  // so the colour isn't encoding a category -- it's marking the thing you came
  // to look at. The rising/declining overlay stays on rise/fall, which is what
  // actually carries meaning here.
  const lineColor = "var(--color-accent)";

  return (
    <div className="mb-4">
      {/* Metric tabs */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1 flex-wrap">
          {metrics.map((m) => (
            <button
              key={m.key}
              onClick={() => setActiveMetric(m.key)}
              className={`text-xs px-2.5 py-1 rounded transition-colors ${
                activeMetric === m.key
                  ? "bg-accent text-accent-ink"
                  : "bg-ink-700 text-chalk-mut hover:text-chalk-dim"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
        {trend && (
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-chalk-mut stat-num">Avg: {metric.format(trend.avg)}</span>
            <span className="text-xs font-medium" style={{ color: trend.color }}>
              {trend.label}
            </span>
          </div>
        )}
      </div>

      {played.length < 2 ? (
        <div className="flex items-center justify-center h-[180px] text-sm text-chalk-mut">
          Not enough data for {metric.label} trend
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: -10 }}>
              {/* Behind everything: the weeks he wasn't on the field. */}
              {absenceBands(runs)}

              <CartesianGrid strokeDasharray="3 3" stroke="rgba(237,234,227,0.05)" />
              <XAxis
                dataKey="week"
                type="number"
                domain={[firstWeek - 0.5, lastWeek + 0.5]}
                ticks={weekTicks}
                allowDecimals={false}
                tick={weekTick(statusByWeek)}
                axisLine={{ stroke: "var(--color-ink-600)" }}
                tickLine={false}
              />
              <YAxis
                domain={metric.domain ?? ["auto", "auto"]}
                tick={{ fill: "var(--color-chalk-mut)", fontSize: 11 }}
                axisLine={{ stroke: "var(--color-ink-600)" }}
                tickLine={false}
                tickFormatter={metric.tickFormat}
              />
              <Tooltip
                content={<ChartTooltip slots={chartData} metric={metric} />}
                cursor={false}
              />

              {trend && (
                <ReferenceLine
                  y={trend.avg}
                  stroke="rgba(237,234,227,0.12)"
                  strokeDasharray="4 4"
                />
              )}

              <Line
                type="monotone"
                dataKey="value"
                stroke={lineColor}
                strokeWidth={2.5}
                dot={{ r: 3.5, fill: lineColor, strokeWidth: 0 }}
                activeDot={{ r: 6, fill: lineColor, strokeWidth: 0 }}
                connectNulls={false}
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

          {counts.missed > 0 && (
            <p className="text-xs text-chalk-mut mt-2">
              Played {counts.played} of {counts.teamGames} team games —{" "}
              <span style={{ color: ABSENCE_MARK.missed }}>
                {counts.missed} missed
              </span>
              , shaded above
            </p>
          )}
        </>
      )}
    </div>
  );
}
