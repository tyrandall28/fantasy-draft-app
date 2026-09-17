import type { RecentForm } from "../../types";

interface Props {
  form: RecentForm | null;
  width?: number;
  height?: number;
}

const TREND_COLOR: Record<string, string> = {
  up: "var(--color-rise)",
  down: "var(--color-fall)",
  flat: "var(--color-chalk-mut)",
  unknown: "#4a4843",
};

function summarize(form: RecentForm): string {
  const span = form.points.length
    ? `${form.points[0].season} wk${form.points[0].week} - ${
        form.points[form.points.length - 1].season
      } wk${form.points[form.points.length - 1].week}`
    : "";
  const lines = [`Last ${form.points.length} team games (${span})`];
  if (form.avg != null) lines.push(`Recent: ${form.avg.toFixed(1)} PPR/G`);
  if (form.baseline != null) lines.push(`Baseline: ${form.baseline.toFixed(1)} PPR/G`);
  if (form.delta_pct != null) {
    const pct = `${form.delta_pct > 0 ? "+" : ""}${(form.delta_pct * 100).toFixed(0)}%`;
    lines.push(`${pct} vs baseline`);
  } else {
    lines.push("Not enough history to judge direction");
  }
  if (form.games_missed > 0) {
    lines.push(`${form.games_missed} game${form.games_missed === 1 ? "" : "s"} not played`);
  }
  return lines.join("\n");
}

/**
 * Recent-form sparkline: one slot per game the player's team played over the
 * last eight, so a missed game keeps its place in the window instead of being
 * silently closed up. Missed games are drawn as a red cross and are excluded
 * from the average -- an absence is not a zero.
 *
 * Colour comes from the backend, which compares this window to the player's own
 * longer baseline. The dashed rule is that baseline, so the line's height reads
 * as "above or below his normal" rather than as an arbitrary local scale.
 */
export default function FormSparkline({ form, width = 84, height = 26 }: Props) {
  if (!form || form.points.length === 0) {
    return <span className="text-chalk-mut text-xs">-</span>;
  }

  const color = TREND_COLOR[form.trend] ?? TREND_COLOR.unknown;
  const slots = form.points;

  // A single game can't make a line. Show the one value so a week-1 rookie
  // reads as "one game played", not as a broken chart.
  if (form.games_played <= 1) {
    const only = slots.find((p) => p.status === "played");
    return (
      <span className="text-chalk-dim text-xs stat-num" title={summarize(form)}>
        {only?.ppr != null ? `${only.ppr.toFixed(1)}` : "-"}
        <span className="text-chalk-mut ml-1">1 gm</span>
      </span>
    );
  }

  const values = slots.filter((p) => p.ppr != null).map((p) => p.ppr as number);
  const candidates = form.baseline != null ? [...values, form.baseline] : values;
  const minVal = Math.min(...candidates);
  const maxVal = Math.max(...candidates);
  const range = maxVal - minVal || 1;

  const pad = 3;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const xAt = (i: number) => pad + (slots.length === 1 ? innerW / 2 : (i / (slots.length - 1)) * innerW);
  const yAt = (v: number) => pad + innerH - ((v - minVal) / range) * innerH;

  const played = slots
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.ppr != null);

  const pathD = played
    .map((p, n) => `${n === 0 ? "M" : "L"} ${xAt(p.i)} ${yAt(p.ppr as number)}`)
    .join(" ");

  const last = played[played.length - 1];
  const missed = slots.map((p, i) => ({ ...p, i })).filter((p) => p.status === "missed");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="inline-block align-middle"
      role="img"
      aria-label={summarize(form)}
    >
      <title>{summarize(form)}</title>

      {form.baseline != null && (
        <line
          x1={pad}
          x2={width - pad}
          y1={yAt(form.baseline)}
          y2={yAt(form.baseline)}
          stroke="var(--color-ink-600)"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}

      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {missed.map((p) => {
        const cx = xAt(p.i);
        const cy = height / 2;
        const r = 2.5;
        return (
          <g key={`${p.season}-${p.week}`} stroke="var(--color-fall)" strokeWidth={1.2} strokeLinecap="round">
            <line x1={cx - r} y1={cy - r} x2={cx + r} y2={cy + r} />
            <line x1={cx - r} y1={cy + r} x2={cx + r} y2={cy - r} />
          </g>
        );
      })}

      {last && <circle cx={xAt(last.i)} cy={yAt(last.ppr as number)} r={2} fill={color} />}
    </svg>
  );
}
