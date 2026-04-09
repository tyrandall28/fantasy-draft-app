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
import { usePlayerCard } from "../../context/PlayerCardContext";
import { useDraftValueAnalysis } from "../../hooks/useDraftValueAnalysis";
import type { PositionCurve } from "../../lib/draftValue";
import type { BaseRankingEntry, UserRankingEntry } from "../../types";

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-emerald-500/20 text-emerald-400",
  WR: "bg-sky-500/20 text-sky-400",
  TE: "bg-amber-500/20 text-amber-400",
  K: "bg-purple-500/20 text-purple-400",
  DST: "bg-slate-500/20 text-slate-400",
};

/** Hex colors for chart lines — match the POS_COLORS palette. */
const POS_HEX: Record<string, string> = {
  QB: "#f87171", // red-400
  RB: "#34d399", // emerald-400
  WR: "#38bdf8", // sky-400
  TE: "#fbbf24", // amber-400
};

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DST"];

interface Props {
  entries: UserRankingEntry[];
  comparisonBaseEntries?: BaseRankingEntry[];
}

interface CurvePoint {
  rank: number;
  QB?: number | null;
  RB?: number | null;
  WR?: number | null;
  TE?: number | null;
}

/** Merge multiple position curves into a single array keyed by positional rank. */
function buildCurveChartData(curves: PositionCurve[]): CurvePoint[] {
  if (curves.length === 0) return [];
  // Cap at the largest replacement rank + 4 so we show a little past replacement
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

export default function PositionOverviewView({ entries, comparisonBaseEntries }: Props) {
  const { openPlayerCard } = usePlayerCard();

  const {
    curves,
    priorityBoard,
    tierBreaks,
    loading: valueLoading,
    season: valueSeason,
  } = useDraftValueAnalysis();

  // Position breakdown
  const positionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.player.position] = (counts[e.player.position] ?? 0) + 1;
    }
    return POS_ORDER
      .filter((pos) => counts[pos] > 0)
      .map((pos) => ({ position: pos, count: counts[pos] }));
  }, [entries]);

  // Top risers / fallers vs comparison base
  const { risers, fallers } = useMemo(() => {
    if (!comparisonBaseEntries?.length) return { risers: [], fallers: [] };
    const baseRankMap = new Map(comparisonBaseEntries.map((e) => [e.player_id, e.rank]));
    const diffs = entries
      .map((entry) => {
        const sourceRank = baseRankMap.get(entry.player_id);
        if (sourceRank === undefined) return null;
        return {
          player: entry.player,
          userRank: entry.rank,
          sourceRank,
          diff: sourceRank - entry.rank,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    return {
      risers: diffs.filter((d) => d.diff > 0).slice(0, 5),
      fallers: diffs.filter((d) => d.diff < 0).slice(0, 5),
    };
  }, [entries, comparisonBaseEntries]);

  const maxCount = Math.max(...positionCounts.map((p) => p.count), 1);

  // Draft Priority Board — only show scoring positions, already sorted by topNVor desc
  const skillPriorities = useMemo(
    () => priorityBoard.filter((p) => POS_HEX[p.position] != null),
    [priorityBoard]
  );
  const maxPriorityVor = skillPriorities.length > 0 ? skillPriorities[0].topNVor : 1;

  const skillCurves = useMemo(
    () => curves.filter((c) => POS_HEX[c.position] != null),
    [curves]
  );
  const chartData = useMemo(() => buildCurveChartData(skillCurves), [skillCurves]);

  const skillTierBreaks = useMemo(
    () => tierBreaks.filter((t) => POS_HEX[t.position] != null),
    [tierBreaks]
  );

  const hasDraftValueData = skillCurves.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Instruction */}
      <div className="bg-sky-500/5 border border-sky-500/15 rounded-lg p-3">
        <p className="text-sm text-sky-300">
          <span className="font-semibold">Tip:</span> Click any player in your rankings to see detailed analytics. Click a second player to compare them head-to-head.
        </p>
      </div>

      {/* ---- Draft Value (VOR) widgets ---- */}
      {valueLoading && !hasDraftValueData && (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-sky-500" />
        </div>
      )}

      {hasDraftValueData && (
        <>
          {/* Widget 1: Draft Priority Board */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                Draft Priority {valueSeason ? `(${valueSeason})` : ""}
              </h3>
              <span className="text-[10px] text-slate-600">
                avg VOR of top 5
              </span>
            </div>
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
                    <div className="flex-1 h-4 bg-white/[0.03] rounded-sm overflow-hidden">
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
                      +{p.topNVor.toFixed(1)}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-600 mt-2 italic">
              Higher VOR = steeper drop-off after the elite. Draft those positions first.
            </p>
          </div>

          {/* Widget 2: Position Value Curves */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Position Value Curves
            </h3>
            <div className="bg-white/[0.02] border border-white/5 rounded-lg p-2">
              <ResponsiveContainer width="100%" height={200}>
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

          {/* Widget 3: Tier Breaks */}
          <div>
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Tier Breaks
            </h3>
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
        </>
      )}

      {/* ---- Existing ranking-list context widgets ---- */}

      {/* Position breakdown */}
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-3">
          Your Position Breakdown
        </h3>
        <div className="space-y-2">
          {positionCounts.map(({ position, count }) => (
            <div key={position} className="flex items-center gap-3">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded w-12 text-center flex-shrink-0 ${POS_COLORS[position] ?? ""}`}>
                {position}
              </span>
              <div className="flex-1 h-5 bg-white/[0.03] rounded-sm overflow-hidden">
                <div
                  className="h-full bg-sky-500/40 rounded-sm transition-all duration-300"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-sm text-slate-300 font-mono w-8 text-right flex-shrink-0">
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risers */}
      {risers.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">
            Top Risers (vs Source)
          </h3>
          <div className="space-y-1">
            {risers.map((d) => (
              <div
                key={d.player.id}
                onClick={() => openPlayerCard(d.player.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-emerald-500/5 text-sm cursor-pointer hover:bg-emerald-500/10"
              >
                <span className="text-emerald-400 font-mono font-bold w-10 text-right flex-shrink-0 text-xs">
                  +{d.diff}
                </span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${POS_COLORS[d.player.position] ?? ""}`}>
                  {d.player.position}
                </span>
                <span className="text-slate-200 truncate flex-1 hover:text-sky-400 transition-colors">
                  {d.player.full_name}
                </span>
                <span className="text-slate-600 text-xs flex-shrink-0">
                  #{d.userRank} vs #{d.sourceRank}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Fallers */}
      {fallers.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">
            Top Fallers (vs Source)
          </h3>
          <div className="space-y-1">
            {fallers.map((d) => (
              <div
                key={d.player.id}
                onClick={() => openPlayerCard(d.player.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-red-500/5 text-sm cursor-pointer hover:bg-red-500/10"
              >
                <span className="text-red-400 font-mono font-bold w-10 text-right flex-shrink-0 text-xs">
                  {d.diff}
                </span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${POS_COLORS[d.player.position] ?? ""}`}>
                  {d.player.position}
                </span>
                <span className="text-slate-200 truncate flex-1 hover:text-sky-400 transition-colors">
                  {d.player.full_name}
                </span>
                <span className="text-slate-600 text-xs flex-shrink-0">
                  #{d.userRank} vs #{d.sourceRank}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!comparisonBaseEntries?.length && (
        <p className="text-xs text-slate-500 text-center italic mt-4">
          Load a source comparison (in the Source tab) to see risers and fallers.
        </p>
      )}
    </div>
  );
}
