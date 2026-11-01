import { useMemo } from "react";
import { usePlayerCard } from "../../context/playerCard";
import { useDraftValueAnalysis } from "../../hooks/useDraftValueAnalysis";
import type { BaseRankingEntry, UserRankingEntry } from "../../types";
import {
  DraftPriorityBoard,
  TierBreaksList,
  ValueCurvesChart,
} from "../analytics/draftValueWidgets";
import { positionBadge } from "../../lib/positionColors";

const POS_ORDER = ["QB", "RB", "WR", "TE", "K", "DST"];

interface Props {
  entries: UserRankingEntry[];
  comparisonBaseEntries?: BaseRankingEntry[];
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
  const hasDraftValueData = curves.length > 0;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-5">
      {/* Instruction */}
      <div className="bg-accent/5 border border-accent/15 rounded-lg p-3">
        <p className="text-sm text-accent">
          <span className="font-semibold">Tip:</span> Click any player in your rankings to see detailed analytics. Click a second player to compare them head-to-head.
        </p>
      </div>

      {/* ---- Draft Value (VOR) widgets ---- */}
      {valueLoading && !hasDraftValueData && (
        <div className="flex items-center justify-center py-6">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
        </div>
      )}

      {hasDraftValueData && (
        <>
          <DraftPriorityBoard
            priorityBoard={priorityBoard}
            headingSuffix={valueSeason ? `(${valueSeason})` : undefined}
          />
          <ValueCurvesChart curves={curves} />
          <TierBreaksList tierBreaks={tierBreaks} />
        </>
      )}

      {/* ---- Existing ranking-list context widgets ---- */}

      {/* Position breakdown */}
      <div>
        <h3 className="text-xs font-semibold text-chalk-dim uppercase tracking-wide mb-3">
          Your Position Breakdown
        </h3>
        <div className="space-y-2">
          {positionCounts.map(({ position, count }) => (
            <div key={position} className="flex items-center gap-3">
              <span className={`badge w-12 text-center flex-shrink-0 ${positionBadge(position)}`}>
                {position}
              </span>
              <div className="flex-1 h-5 bg-ink-700 rounded-sm overflow-hidden">
                <div
                  className="h-full bg-accent/40 rounded-sm transition-all duration-300"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
              </div>
              <span className="text-sm text-chalk-dim font-mono w-8 text-right flex-shrink-0">
                {count}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Risers */}
      {risers.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-rise uppercase tracking-wide mb-2">
            Top Risers (vs Source)
          </h3>
          <div className="space-y-1">
            {risers.map((d) => (
              <div
                key={d.player.id}
                onClick={() => openPlayerCard(d.player.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-rise/5 text-sm cursor-pointer hover:bg-rise/10"
              >
                <span className="text-rise font-mono font-bold w-10 text-right flex-shrink-0 text-xs">
                  +{d.diff}
                </span>
                <span className={`badge flex-shrink-0 ${positionBadge(d.player.position)}`}>
                  {d.player.position}
                </span>
                <span className="text-chalk-dim truncate flex-1 hover:text-accent transition-colors">
                  {d.player.full_name}
                </span>
                <span className="text-chalk-mut text-xs flex-shrink-0">
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
          <h3 className="text-xs font-semibold text-fall uppercase tracking-wide mb-2">
            Top Fallers (vs Source)
          </h3>
          <div className="space-y-1">
            {fallers.map((d) => (
              <div
                key={d.player.id}
                onClick={() => openPlayerCard(d.player.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-fall/5 text-sm cursor-pointer hover:bg-fall/10"
              >
                <span className="text-fall font-mono font-bold w-10 text-right flex-shrink-0 text-xs">
                  {d.diff}
                </span>
                <span className={`badge flex-shrink-0 ${positionBadge(d.player.position)}`}>
                  {d.player.position}
                </span>
                <span className="text-chalk-dim truncate flex-1 hover:text-accent transition-colors">
                  {d.player.full_name}
                </span>
                <span className="text-chalk-mut text-xs flex-shrink-0">
                  #{d.userRank} vs #{d.sourceRank}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!comparisonBaseEntries?.length && (
        <p className="text-xs text-chalk-mut text-center italic mt-4">
          Load a source comparison (in the Source tab) to see risers and fallers.
        </p>
      )}
    </div>
  );
}
