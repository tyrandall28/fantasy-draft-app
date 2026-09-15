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
  DraftSuggestion,
  OpenSlots,
  PositionCurve,
  PositionDepletion,
  PositionPriority,
  PositionSlots,
  PositionTiers,
  RankedPlayer,
} from "../../lib/draftValue";
import { rosterSlotForPlayer } from "../../lib/draftValue";

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
  /** Positions are assigned dynamically in buildCurveChartData. */
  [position: string]: number | null | undefined;
}

function buildCurveChartData(curves: PositionCurve[]): CurvePoint[] {
  if (curves.length === 0) return [];
  const maxRank = Math.max(...curves.map((c) => c.replacementRank + 4));
  const points: CurvePoint[] = [];
  for (let r = 1; r <= maxRank; r++) {
    const point: CurvePoint = { rank: r };
    for (const curve of curves) {
      const player = curve.players[r - 1];
      point[curve.position] = player ? player.ppg : null;
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

/* ── Depletion Strip ───────────────────────────────────────────── */

interface DepletionStripProps {
  depletion: PositionDepletion[];
  /** Render compactly inline (1 row) vs stacked rows. Default = stacked. */
  inline?: boolean;
}

export function DepletionStrip({ depletion, inline = false }: DepletionStripProps) {
  const rows = useMemo(
    () => depletion.filter((d) => POS_HEX[d.position] != null && d.total > 0),
    [depletion]
  );

  if (rows.length === 0) return null;

  return (
    <div
      className={
        inline
          ? "flex items-center gap-3 flex-wrap"
          : "space-y-1"
      }
    >
      {rows.map((d) => {
        const pct = d.total > 0 ? (d.drafted / d.total) * 100 : 0;
        const accent = POS_HEX[d.position] ?? "#94a3b8";
        return (
          <div
            key={d.position}
            className={inline ? "flex items-center gap-1.5 flex-1 min-w-[140px]" : "flex items-center gap-2"}
          >
            <span
              className={`text-[10px] font-semibold px-1.5 py-0.5 rounded w-8 text-center flex-shrink-0 ${POS_COLORS[d.position] ?? ""}`}
            >
              {d.position}
            </span>
            <div className="flex-1 h-2 bg-white/[0.04] rounded-sm overflow-hidden min-w-0">
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: accent + "cc",
                }}
              />
            </div>
            <span
              className="text-[10px] font-mono text-slate-500 w-12 text-right flex-shrink-0"
              title={`${d.drafted} of top ${d.total} drafted`}
            >
              {d.drafted}/{d.total}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ── Suggestion Card (hero) ────────────────────────────────────── */

interface SuggestionCardProps {
  suggestion: DraftSuggestion | null;
  isMyTurn?: boolean;
  onPick?: (playerId: number) => void;
}

export function SuggestionCard({ suggestion, isMyTurn, onPick }: SuggestionCardProps) {
  if (!suggestion) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 text-center">
        <p className="text-xs text-slate-500">No suggestion available yet.</p>
      </div>
    );
  }

  const { player, slot, reason } = suggestion;
  const pos = player.player.position;
  const accent = POS_HEX[pos] ?? "#94a3b8";
  const canPick = isMyTurn && onPick != null;

  return (
    <div
      className="rounded-lg border p-3 transition-colors"
      style={{
        borderColor: accent + "55",
        background: `linear-gradient(135deg, ${accent}14, transparent 70%)`,
      }}
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-amber-400 text-sm">★</span>
            <span className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
              Suggested pick
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-xs font-bold px-1.5 py-0.5 rounded ${POS_COLORS[pos] ?? ""}`}
            >
              {pos}
            </span>
            <span className="text-base font-semibold text-white truncate">
              {player.player.full_name}
            </span>
            <span className="text-xs text-slate-500">{player.player.nfl_team}</span>
            <span
              className="text-sm font-mono font-bold"
              style={{ color: accent }}
            >
              +{player.vor.toFixed(1)} VOR
            </span>
            {slot && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                style={{
                  color: accent,
                  borderColor: accent + "55",
                  backgroundColor: accent + "0d",
                }}
              >
                {slot}
              </span>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-1.5 italic">{reason}</p>
        </div>
        {canPick && (
          <button
            onClick={() => onPick!(player.player.player_id)}
            className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-3 py-1.5 rounded transition-colors flex-shrink-0"
          >
            Draft
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Best Available List ───────────────────────────────────────── */

interface BestAvailableListProps {
  players: RankedPlayer[];
  openSlots?: OpenSlots;
  positionSlots?: PositionSlots;
  /** Highlight this player_id (e.g. the current suggestion). */
  highlightId?: number;
  /** When provided, rows become clickable and call this on click. */
  onPick?: (playerId: number) => void;
  isMyTurn?: boolean;
  /** Max rows to render. Defaults to 15. */
  limit?: number;
  hideHeading?: boolean;
}

export function BestAvailableList({
  players,
  openSlots,
  positionSlots,
  highlightId,
  onPick,
  isMyTurn,
  limit = 15,
  hideHeading = false,
}: BestAvailableListProps) {
  const rows = useMemo(() => players.slice(0, limit), [players, limit]);

  if (rows.length === 0) {
    return (
      <div className="text-center py-4">
        <p className="text-xs text-slate-500">No players available.</p>
      </div>
    );
  }

  const interactive = isMyTurn && onPick != null;

  return (
    <div>
      {!hideHeading && (
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
            Best Available
          </h3>
          <span className="text-[10px] text-slate-600">by VOR · across all positions</span>
        </div>
      )}
      <div className="rounded-lg border border-white/5 bg-white/[0.02] overflow-hidden">
        {rows.map((rp, i) => {
          const pos = rp.player.position;
          const accent = POS_HEX[pos] ?? "#94a3b8";
          const slot = openSlots
            ? rosterSlotForPlayer(rp, openSlots, positionSlots)
            : null;
          const isHighlight = highlightId === rp.player.player_id;
          return (
            <div
              key={rp.player.player_id}
              onClick={interactive ? () => onPick!(rp.player.player_id) : undefined}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm border-b border-white/5 last:border-b-0 transition-colors ${
                interactive ? "cursor-pointer hover:bg-white/[0.04]" : ""
              } ${isHighlight ? "bg-amber-500/5" : ""}`}
            >
              <span className="text-slate-600 font-mono text-[10px] w-5 text-right flex-shrink-0">
                {i + 1}
              </span>
              <span
                className={`text-[10px] font-bold px-1.5 py-0.5 rounded w-8 text-center flex-shrink-0 ${POS_COLORS[pos] ?? ""}`}
              >
                {pos}
              </span>
              <span className="text-slate-200 font-medium truncate flex-1 min-w-0">
                {rp.player.full_name}
                {isHighlight && <span className="text-amber-400 ml-1">★</span>}
              </span>
              <span className="text-slate-600 text-[11px] w-9 text-right flex-shrink-0">
                {rp.player.nfl_team}
              </span>
              <span
                className="text-xs font-mono font-semibold w-12 text-right flex-shrink-0"
                style={{ color: accent }}
              >
                +{rp.vor.toFixed(1)}
              </span>
              <span className="w-12 flex-shrink-0 text-right">
                {slot ? (
                  <span
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                    style={{
                      color: accent,
                      borderColor: accent + "44",
                      backgroundColor: accent + "0d",
                    }}
                  >
                    {slot}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-700">BN</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-600 mt-1.5 italic">
        Slot badges show where each pick would land on your roster. "BN" = bench filler.
      </p>
    </div>
  );
}
