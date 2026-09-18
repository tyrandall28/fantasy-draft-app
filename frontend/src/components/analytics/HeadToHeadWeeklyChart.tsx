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
import { weekStatus, type WeekStatus } from "../../lib/weeklyTimeline";
import { markerColumns, weekTick, type WeekMark } from "./absenceLayer";

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

const PLAYER_COLORS = ["#4da3ff", "#e0a33e"]; // sky, amber — match compare pills

interface ChartPoint {
  week: number;
  [playerName: string]: string | number | null;
}

/** A week where at least one of the two was not on the field, and why. */
interface AbsenceColumn {
  week: number;
  band?: string;
  marks: WeekMark[];
}

const ABSENCE_TEXT: Record<Exclude<WeekStatus, "played">, string> = {
  missed: "did not play",
  bye: "on bye",
  inactive: "not yet in the NFL",
};

interface TooltipPlayer {
  name: string;
  color: string;
  byWeek: Map<number, PlayerWeekly>;
}

function H2HTooltip({
  active,
  label,
  metric,
  players,
}: {
  active?: boolean;
  label?: string | number;
  metric: H2HMetric;
  /** Both players in fixed order, so an absent week can still name them. */
  players: TooltipPlayer[];
}) {
  if (!active) return null;
  const week = typeof label === "number" ? label : Number(label);
  if (!Number.isFinite(week)) return null;

  return (
    <div className="panel-raised px-3 py-2 shadow-xl">
      <p className="text-chalk text-sm font-medium mb-1">Week {week}</p>
      {players.map((p) => {
        const slot = p.byWeek.get(week);
        if (!slot) return null;
        const status = weekStatus(slot);
        const value = status === "played" ? metric.getValue(slot) : null;
        return (
          <p key={p.name} className="text-xs" style={{ color: p.color }}>
            {p.name}:{" "}
            {value != null ? (
              <span className="font-mono">{metric.format(value)}</span>
            ) : (
              <span className="text-chalk-dim">
                {ABSENCE_TEXT[status === "played" ? "missed" : status]}
              </span>
            )}
          </p>
        );
      })}
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

  const players = useMemo<TooltipPlayer[]>(
    () => [
      { name: nameA, color: PLAYER_COLORS[0], byWeek: new Map(weeksA.map((w) => [w.week, w])) },
      { name: nameB, color: PLAYER_COLORS[1], byWeek: new Map(weeksB.map((w) => [w.week, w])) },
    ],
    [weeksA, weeksB, nameA, nameB]
  );

  // Every week either of them has a slot for, in order. A week one of them sat
  // out carries a null for him, which breaks his line rather than bridging it --
  // the old connectNulls drew a straight line through a month on the sideline.
  const chartData = useMemo<ChartPoint[]>(() => {
    const weeks = new Set<number>();
    for (const p of players) for (const week of p.byWeek.keys()) weeks.add(week);

    return [...weeks]
      .sort((a, b) => a - b)
      .map((week) => {
        const point: ChartPoint = { week };
        for (const p of players) {
          const slot = p.byWeek.get(week);
          point[p.name] = slot && weekStatus(slot) === "played" ? metric.getValue(slot) : null;
        }
        return point;
      });
  }, [players, metric]);

  /** Weeks where at least one of them was out. */
  const absences = useMemo<AbsenceColumn[]>(() => {
    const columns: AbsenceColumn[] = [];
    for (const point of chartData) {
      const marks: WeekMark[] = [];
      let present = 0;
      for (const p of players) {
        const slot = p.byWeek.get(point.week);
        if (!slot) continue;
        const status = weekStatus(slot);
        if (status === "played") {
          present++;
        } else {
          marks.push({ color: p.color, kind: status === "bye" ? "bye" : "missed" });
        }
      }
      if (marks.length === 0) continue;
      columns.push({
        week: point.week,
        // Shaded only when neither played: there is nothing to compare there.
        band: present === 0 ? "rgba(148,163,184,0.06)" : undefined,
        marks,
      });
    }
    return columns;
  }, [chartData, players]);

  /** Dim a week on the axis only when neither of them played it. */
  const statusByWeek = useMemo(() => {
    const map = new Map<number, WeekStatus>();
    for (const point of chartData) {
      const anyPlayed = players.some((p) => {
        const slot = p.byWeek.get(point.week);
        return slot != null && weekStatus(slot) === "played";
      });
      map.set(point.week, anyPlayed ? "played" : "bye");
    }
    return map;
  }, [chartData, players]);

  const weekTicks = useMemo(() => chartData.map((d) => d.week), [chartData]);
  const hasData = chartData.some((d) => players.some((p) => d[p.name] != null));
  const firstWeek = chartData[0]?.week ?? 1;
  const lastWeek = chartData[chartData.length - 1]?.week ?? 1;

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
                ? "bg-accent text-accent-ink"
                : "bg-ink-700 text-chalk-dim hover:bg-ink-600"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {!hasData ? (
        <div className="flex items-center justify-center h-[180px] text-xs text-chalk-mut">
          No weekly data available for {metric.label}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -15 }}>
            {/* Behind everything: the weeks one of them was not on the field. */}
            {markerColumns(absences)}

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
              domain={metric.domain ?? ["auto", "auto"]}
              tick={{ fill: "#6b6862", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              tickFormatter={metric.tickFormat}
            />
            <Tooltip
              content={<H2HTooltip metric={metric} players={players} />}
              cursor={false}
            />
            <Legend
              wrapperStyle={{ fontSize: 11, color: "#9a968c", paddingTop: 4 }}
              iconType="line"
            />
            <Line
              type="monotone"
              dataKey={nameA}
              stroke={PLAYER_COLORS[0]}
              strokeWidth={2}
              dot={{ r: 3, fill: PLAYER_COLORS[0], strokeWidth: 0 }}
              activeDot={{ r: 5, fill: PLAYER_COLORS[0], strokeWidth: 0 }}
              connectNulls={false}
              animationDuration={400}
            />
            <Line
              type="monotone"
              dataKey={nameB}
              stroke={PLAYER_COLORS[1]}
              strokeWidth={2}
              dot={{ r: 3, fill: PLAYER_COLORS[1], strokeWidth: 0 }}
              activeDot={{ r: 5, fill: PLAYER_COLORS[1], strokeWidth: 0 }}
              connectNulls={false}
              animationDuration={400}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {hasData && absences.length > 0 && (
        <p className="text-[10px] text-chalk-mut mt-1">
          <span className="font-mono">&#10005;</span> did not play &middot;{" "}
          <span className="font-mono">&#9675;</span> bye &mdash; in each player&apos;s colour
        </p>
      )}
    </div>
  );
}
