import { useMemo } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  PositionCurve,
  PositionPriority,
  PositionTiers,
} from "../../lib/draftValue";

/**
 * Shared draft-value widgets. Layout-agnostic — consumers compose them
 * vertically (rankings side panel) or horizontally (draft bottom panel).
 */

export const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-emerald-500/20 text-emerald-400",
  WR: "bg-sky-500/20 text-sky-400",
  TE: "bg-amber-500/20 text-amber-400",
  K: "bg-purple-500/20 text-purple-400",
  DST: "bg-slate-500/20 text-slate-400",
};

/** Hex colors for chart lines and inline accents — match POS_COLORS. */
export const POS_HEX: Record<string, string> = {
  QB: "#f87171", // red-400
  RB: "#34d399", // emerald-400
  WR: "#38bdf8", // sky-400
  TE: "#fbbf24", // amber-400
};

/* ── Draft Priority Board ───────────────────────────────────────── */

interface DraftPriorityBoardProps {
  priorityBoard: PositionPriority[];
  /** Override the default subtitle under the heading */
  subtitle?: string;
  /** Hide the heading entirely (for minimal embeds) */
  hideHeading?: boolean;
  headingSuffix?: string;
}

export function DraftPriorityBoard({
  priorityBoard,
  subtitle = "avg VOR of top 5",
  hideHeading = false,
  headingSuffix,
}: DraftPriorityBoardProps) {
  const skillPriorities = useMemo(
    () => priorityBoard.filter((p) => POS_HEX[p.position] != null),
    [priorityBoard]
  );
  const maxPriorityVor = skillPriorities.length > 0 ? skillPriorities[0].topNVor : 1;

  if (skillPriorities.length === 0) return null;

  return (
    <div>
      {!hideHeading && (
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Draft Priority{headingSuffix ? ` ${headingSuffix}` : ""}
          </h3>
          <span className="text-[10px] text-slate-600">{subtitle}</span>
        </div>
      )}
      <div className="space-y-1.5">
        {skillPriorities.map((p, i) => {
          const widthPct = maxPriorityVor > 0 ? (p.topNVor / maxPriorityVor) * 100 : 0;
          return (
            <div key={p.position} className="flex items-center gap-2">
              <span className="text-slate-600 font-mono text-[10px] w-4 text-right flex-shrink-0">
                {i + 1}
              </span>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded w-10 text-center flex-shrink-0 ${POS_COLORS[p.position] ?? ""}`}
              >
                {p.position}
              </span>
              <div className="flex-1 h-4 bg-white/[0.03] rounded-sm overflow-hidden min-w-0">
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{
                    width: `${Math.max(widthPct, 2)}%`,
                    backgroundColor: POS_HEX[p.position] + "cc",
                  }}
                />
              </div>
              <span
                className="text-xs font-mono font-semibold w-12 text-right flex-shrink-0"
                style={{ color: POS_HEX[p.position] }}
              >
                {p.topNVor >= 0 ? "+" : ""}
                {p.topNVor.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-600 mt-2 italic">
        Higher VOR = steeper drop-off after the elite. Draft those positions first.
      </p>
    </div>
  );
}

/* ── Value Curves Chart ─────────────────────────────────────────── */

interface CurvePoint {
  rank: number;
  QB?: number | null;
  RB?: number | null;
  WR?: number | null;
  TE?: number | null;
}

function buildCurveChartData(curves: PositionCurve[]): CurvePoint[] {
  if (curves.length === 0) return [];
  const maxRank = Math.max(...curves.map((c) => c.replacementRank + 4));
  const points: CurvePoint[] = [];
  for (let r = 1; r <= maxRank; r++) {
    const point: CurvePoint = { rank: r };
    for (const curve of curves) {
      const player = curve.players[r - 1];
      (point as Record<string, number | null | undefined>)[curve.position] =
        player ? player.ppg : null;
    }
    points.push(point);
  }
  return points;
}

function CurveTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value != null);
  if (rows.length === 0) return null;
  return (
    <div className="bg-[#1a1d28] border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="text-white text-xs font-medium mb-1">Rank #{label}</p>
      {rows.map((entry) => (
        <p key={entry.name} className="text-[11px]" style={{ color: entry.color }}>
          {entry.name}: <span className="font-mono">{entry.value!.toFixed(1)}</span>
        </p>
      ))}
    </div>
  );
}

interface ValueCurvesChartProps {
  curves: PositionCurve[];
  height?: number;
  hideHeading?: boolean;
}

export function ValueCurvesChart({
  curves,
  height = 200,
  hideHeading = false,
}: ValueCurvesChartProps) {
  const skillCurves = useMemo(
    () => curves.filter((c) => POS_HEX[c.position] != null),
    [curves]
  );
  const chartData = useMemo(() => buildCurveChartData(skillCurves), [skillCurves]);

  if (skillCurves.length === 0) return null;

  return (
    <div>
      {!hideHeading && (
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Position Value Curves
        </h3>
      )}
      <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="rank"
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              label={{
                value: "Positional Rank",
                position: "insideBottom",
                offset: -2,
                style: { fill: "#475569", fontSize: 10 },
              }}
            />
            <YAxis
              tick={{ fill: "#64748b", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
            <Legend
              wrapperStyle={{ fontSize: 10, color: "#94a3b8", paddingTop: 4 }}
              iconType="line"
            />
            {skillCurves.map((curve) => (
              <ReferenceLine
                key={`ref-${curve.position}`}
                y={curve.replacementPpg}
                stroke={POS_HEX[curve.position]}
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
            ))}
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <Line
                key={pos}
                type="monotone"
                dataKey={pos}
                stroke={POS_HEX[pos]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls
                animationDuration={500}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-slate-600 mt-1.5 italic">
        Dashed lines = replacement level (last startable player at each position).
      </p>
    </div>
  );
}

/* ── Tier Breaks List ───────────────────────────────────────────── */

interface TierBreaksListProps {
  tierBreaks: PositionTiers[];
  hideHeading?: boolean;
}

export function TierBreaksList({ tierBreaks, hideHeading = false }: TierBreaksListProps) {
  const skillTierBreaks = useMemo(
    () => tierBreaks.filter((t) => POS_HEX[t.position] != null),
    [tierBreaks]
  );

  if (skillTierBreaks.length === 0) return null;

  return (
    <div>
      {!hideHeading && (
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
          Tier Breaks
        </h3>
      )}
      <div className="space-y-1.5">
        {skillTierBreaks.map((pt) => (
          <div key={pt.position} className="flex items-center gap-2">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded w-10 text-center flex-shrink-0 ${POS_COLORS[pt.position] ?? ""}`}
            >
              {pt.position}
            </span>
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {pt.tiers.map((tier) => (
                <span
                  key={tier.tierNumber}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                  style={{
                    color: POS_HEX[pt.position],
                    borderColor: POS_HEX[pt.position] + "44",
                    backgroundColor: POS_HEX[pt.position] + "0d",
                  }}
                  title={`Tier ${tier.tierNumber}: ${tier.players.length} players`}
                >
                  T{tier.tierNumber}: #{tier.startRank}
                  {tier.endRank !== tier.startRank ? `–#${tier.endRank}` : ""}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-slate-600 mt-2 italic">
        Auto-detected from PPG gaps. A big gap after a tier = a cliff you don't want to fall off.
      </p>
    </div>
  );
}
