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
import {
  isChartPosition,
  positionBadge,
  positionColor,
  positionTint,
} from "../../lib/positionColors";

/**
 * Shared draft-value widgets. Layout-agnostic — consumers compose them
 * vertically (rankings side panel) or horizontally (draft bottom panel).
 */


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
    () => priorityBoard.filter((p) => isChartPosition(p.position)),
    [priorityBoard]
  );
  const maxPriorityVor = skillPriorities.length > 0 ? skillPriorities[0].topNVor : 1;

  if (skillPriorities.length === 0) return null;

  return (
    <div>
      {!hideHeading && (
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-chalk-dim uppercase tracking-wide">
            Draft Priority{headingSuffix ? ` ${headingSuffix}` : ""}
          </h3>
          <span className="text-[10px] text-chalk-mut">{subtitle}</span>
        </div>
      )}
      <div className="space-y-1.5">
        {skillPriorities.map((p, i) => {
          const widthPct = maxPriorityVor > 0 ? (p.topNVor / maxPriorityVor) * 100 : 0;
          return (
            <div key={p.position} className="flex items-center gap-2">
              <span className="text-chalk-mut font-mono text-[10px] w-4 text-right flex-shrink-0">
                {i + 1}
              </span>
              <span
                className={`badge w-10 text-center flex-shrink-0 ${positionBadge(p.position)}`}
              >
                {p.position}
              </span>
              <div className="flex-1 h-4 bg-ink-700 rounded-sm overflow-hidden min-w-0">
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{
                    width: `${Math.max(widthPct, 2)}%`,
                    backgroundColor: positionTint(p.position, 80),
                  }}
                />
              </div>
              <span
                className="text-xs font-mono font-semibold w-12 text-right flex-shrink-0"
                style={{ color: positionColor(p.position) }}
              >
                {p.topNVor >= 0 ? "+" : ""}
                {p.topNVor.toFixed(1)}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-chalk-mut mt-2 italic">
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
    <div className="panel-raised px-3 py-2 shadow-xl">
      <p className="text-chalk text-xs font-medium mb-1">Rank #{label}</p>
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
    () => curves.filter((c) => isChartPosition(c.position)),
    [curves]
  );
  const chartData = useMemo(() => buildCurveChartData(skillCurves), [skillCurves]);

  if (skillCurves.length === 0) return null;

  return (
    <div>
      {!hideHeading && (
        <h3 className="text-xs font-semibold text-chalk-dim uppercase tracking-wide mb-2">
          Position Value Curves
        </h3>
      )}
      <div className="panel-inset p-2">
        <ResponsiveContainer width="100%" height={height}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 5, left: -18 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis
              dataKey="rank"
              tick={{ fill: "#6b6862", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
              label={{
                value: "Positional Rank",
                position: "insideBottom",
                offset: -2,
                style: { fill: "#4a4843", fontSize: 10 },
              }}
            />
            <YAxis
              tick={{ fill: "#6b6862", fontSize: 10 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <Tooltip content={<CurveTooltip />} cursor={{ stroke: "rgba(255,255,255,0.08)" }} />
            <Legend
              wrapperStyle={{ fontSize: 10, color: "#9a968c", paddingTop: 4 }}
              iconType="line"
            />
            {skillCurves.map((curve) => (
              <ReferenceLine
                key={`ref-${curve.position}`}
                y={curve.replacementPpg}
                stroke={positionColor(curve.position)}
                strokeOpacity={0.3}
                strokeDasharray="3 3"
              />
            ))}
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <Line
                key={pos}
                type="monotone"
                dataKey={pos}
                stroke={positionColor(pos)}
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
      <p className="text-[10px] text-chalk-mut mt-1.5 italic">
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
    () => tierBreaks.filter((t) => isChartPosition(t.position)),
    [tierBreaks]
  );

  if (skillTierBreaks.length === 0) return null;

  return (
    <div>
      {!hideHeading && (
        <h3 className="text-xs font-semibold text-chalk-dim uppercase tracking-wide mb-2">
          Tier Breaks
        </h3>
      )}
      <div className="space-y-1.5">
        {skillTierBreaks.map((pt) => (
          <div key={pt.position} className="flex items-center gap-2">
            <span
              className={`badge w-10 text-center flex-shrink-0 ${positionBadge(pt.position)}`}
            >
              {pt.position}
            </span>
            <div className="flex flex-wrap gap-1 flex-1 min-w-0">
              {pt.tiers.map((tier) => (
                <span
                  key={tier.tierNumber}
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                  style={{
                    color: positionColor(pt.position),
                    borderColor: positionTint(pt.position, 27),
                    backgroundColor: positionTint(pt.position, 5),
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
      <p className="text-[10px] text-chalk-mut mt-2 italic">
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
    () => depletion.filter((d) => isChartPosition(d.position) && d.total > 0),
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
        const accent = positionColor(d.position);
        return (
          <div
            key={d.position}
            className={inline ? "flex items-center gap-1.5 flex-1 min-w-[140px]" : "flex items-center gap-2"}
          >
            <span
              className={`badge-sm w-8 text-center flex-shrink-0 ${positionBadge(d.position)}`}
            >
              {d.position}
            </span>
            <div className="flex-1 h-2 bg-ink-600 rounded-sm overflow-hidden min-w-0">
              <div
                className="h-full rounded-sm transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: accent + "cc",
                }}
              />
            </div>
            <span
              className="text-[10px] font-mono text-chalk-mut w-12 text-right flex-shrink-0"
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
      <div className="panel-inset p-3 text-center">
        <p className="text-xs text-chalk-mut">No suggestion available yet.</p>
      </div>
    );
  }

  const { player, slot, reason } = suggestion;
  const pos = player.player.position;
  const accent = positionColor(pos);
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
            <span className="text-caution text-sm">★</span>
            <span className="text-[10px] uppercase tracking-wide text-chalk-dim font-semibold">
              Suggested pick
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`badge ${positionBadge(pos)}`}
            >
              {pos}
            </span>
            <span className="text-base font-semibold text-chalk truncate">
              {player.player.full_name}
            </span>
            <span className="text-xs text-chalk-mut">{player.player.nfl_team}</span>
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
          <p className="text-[11px] text-chalk-mut mt-1.5 italic">{reason}</p>
        </div>
        {canPick && (
          <button
            onClick={() => onPick!(player.player.player_id)}
            className="btn-primary text-xs font-semibold px-3 py-1.5 flex-shrink-0"
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
        <p className="text-xs text-chalk-mut">No players available.</p>
      </div>
    );
  }

  const interactive = isMyTurn && onPick != null;

  return (
    <div>
      {!hideHeading && (
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-xs font-semibold text-chalk-dim uppercase tracking-wide">
            Best Available
          </h3>
          <span className="text-[10px] text-chalk-mut">by VOR · across all positions</span>
        </div>
      )}
      <div className="panel-inset overflow-hidden">
        {rows.map((rp, i) => {
          const pos = rp.player.position;
          const accent = positionColor(pos);
          const slot = openSlots
            ? rosterSlotForPlayer(rp, openSlots, positionSlots)
            : null;
          const isHighlight = highlightId === rp.player.player_id;
          return (
            <div
              key={rp.player.player_id}
              onClick={interactive ? () => onPick!(rp.player.player_id) : undefined}
              className={`flex items-center gap-2 px-3 py-1.5 text-sm border-b border-ink-700 last:border-b-0 transition-colors ${
                interactive ? "cursor-pointer hover:bg-ink-600" : ""
              } ${isHighlight ? "bg-caution/5" : ""}`}
            >
              <span className="text-chalk-mut font-mono text-[10px] w-5 text-right flex-shrink-0">
                {i + 1}
              </span>
              <span
                className={`badge-sm w-8 text-center flex-shrink-0 ${positionBadge(pos)}`}
              >
                {pos}
              </span>
              <span className="text-chalk-dim font-medium truncate flex-1 min-w-0">
                {rp.player.full_name}
                {isHighlight && <span className="text-caution ml-1">★</span>}
              </span>
              <span className="text-chalk-mut text-[11px] w-9 text-right flex-shrink-0">
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
                  <span className="text-[10px] text-chalk-mut">BN</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-chalk-mut mt-1.5 italic">
        Slot badges show where each pick would land on your roster. "BN" = bench filler.
      </p>
    </div>
  );
}
