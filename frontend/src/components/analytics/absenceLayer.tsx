import type { ReactElement } from "react";
import { Label, ReferenceArea } from "recharts";
import type { XAxisTickContentProps } from "recharts/types/util/types";
import {
  ABSENCE_FILL,
  ABSENCE_MARK,
  weekTickFill,
  type AbsenceRun,
  type WeekStatus,
} from "../../lib/weeklyTimeline";

/**
 * The absence layer for any weekly chart: a faint band behind each week the
 * player didn't play, with a cross (or "BYE") at the top of it.
 *
 * Geometry note -- these need an x axis of `type="number"`, because the bands
 * have to span the half-week either side of a slot and a category axis can only
 * address slot centres. With `domain={[first - 0.5, last + 0.5]}` the weeks come
 * out evenly spaced exactly as they did before, so nothing else about the chart
 * changes.
 */

interface ViewBox {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** One cross per week in the run, spaced across the band. */
function renderAbsenceMarks(run: AbsenceRun, viewBox?: ViewBox) {
  const { x, y, width } = viewBox ?? {};
  // An empty group, not null: Recharts' label `content` must return something
  // renderable. Inactive weeks get the band but no mark -- he wasn't absent, he
  // wasn't in the league.
  if (x == null || y == null || width == null || run.status === "inactive") return <g />;

  const span = run.end - run.start + 1;
  const slot = width / span;
  const cy = y + 9;
  const color = ABSENCE_MARK[run.status];

  return (
    <g>
      {Array.from({ length: span }, (_, i) => {
        const cx = x + (i + 0.5) * slot;
        if (run.status === "bye") {
          return (
            <text
              key={i}
              x={cx}
              y={cy + 3}
              fill={color}
              fontSize={9.5}
              textAnchor="middle"
              letterSpacing="0.05em"
            >
              BYE
            </text>
          );
        }
        const r = 4;
        return (
          <g key={i} stroke={color} strokeWidth={1.8} strokeLinecap="round">
            <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
            <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} />
          </g>
        );
      })}
    </g>
  );
}

/**
 * Renders as a flat array so the ReferenceAreas stay direct children of the
 * chart -- Recharts resolves its cartesian children by inspecting them, and a
 * wrapper component around these would hide them.
 */
export function absenceBands(runs: AbsenceRun[]): ReactElement[] {
  return runs.map((run) => (
    <ReferenceArea
      key={`${run.status}-${run.start}`}
      x1={run.start - 0.5}
      x2={run.end + 0.5}
      fill={ABSENCE_FILL[run.status]}
      fillOpacity={1}
      stroke="none"
      ifOverflow="visible"
    >
      <Label content={(props) => renderAbsenceMarks(run, props.viewBox as ViewBox)} />
    </ReferenceArea>
  ));
}

/**
 * X-axis tick that dims the weeks without a game, so the axis agrees with the
 * bands even where a band is too narrow to read.
 */
export function weekTick(statusByWeek: Map<number, WeekStatus>) {
  return function WeekTick({ x, y, payload }: XAxisTickContentProps) {
    const week = Number(payload?.value);
    if (!Number.isFinite(week)) return <g />;
    return (
      <text
        x={x}
        y={y}
        dy={10}
        fill={weekTickFill(statusByWeek.get(week) ?? "played")}
        fontSize={11}
        textAnchor="middle"
      >
        {week}
      </text>
    );
  };
}

/** One player's absence in a head-to-head week. */
export interface WeekMark {
  color: string;
  kind: "missed" | "bye";
}

/**
 * The two-player variant. Bands can't be tinted per player, so a comparison
 * chart marks each player's absence separately -- stacked at the top of the week
 * in that player's own line colour -- and shades the week only when neither of
 * them played, where there is nothing to compare at all.
 */
export function markerColumns(
  columns: Array<{ week: number; band?: string; marks: WeekMark[] }>
): ReactElement[] {
  return columns.map((col) => (
    <ReferenceArea
      key={`col-${col.week}`}
      x1={col.week - 0.5}
      x2={col.week + 0.5}
      fill={col.band ?? "none"}
      fillOpacity={col.band ? 1 : 0}
      stroke="none"
      ifOverflow="visible"
    >
      <Label content={(props) => renderStackedMarks(col.marks, props.viewBox as ViewBox)} />
    </ReferenceArea>
  ));
}

function renderStackedMarks(marks: WeekMark[], viewBox?: ViewBox) {
  const { x, y, width } = viewBox ?? {};
  if (x == null || y == null || width == null) return <g />;
  const cx = x + width / 2;

  return (
    <g>
      {marks.map((mark, i) => {
        const cy = y + 8 + i * 11;
        if (mark.kind === "bye") {
          return (
            <circle
              key={i}
              cx={cx}
              cy={cy}
              r={3}
              fill="none"
              stroke={mark.color}
              strokeWidth={1.3}
              opacity={0.65}
            />
          );
        }
        const r = 3.5;
        return (
          <g key={i} stroke={mark.color} strokeWidth={1.7} strokeLinecap="round">
            <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
            <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} />
          </g>
        );
      })}
    </g>
  );
}
