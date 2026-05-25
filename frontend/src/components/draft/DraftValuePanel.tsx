import { useMemo } from "react";
import { useDraft } from "../../context/DraftContext";
import { useDraftValueAnalysis } from "../../hooks/useDraftValueAnalysis";
import {
  DraftPriorityBoard,
  TierBreaksList,
  ValueCurvesChart,
} from "../analytics/draftValueWidgets";

/**
 * Live draft-value advisor. Subscribes to DraftContext, filters the player
 * pool by the current draftedPlayerIds, and re-runs VOR / tier / priority
 * compute on every pick. Same compute pipeline as the static rankings view.
 */
export default function DraftValuePanel() {
  const { state, draftedPlayerIds } = useDraft();

  const { curves, priorityBoard, tierBreaks, loading, season } =
    useDraftValueAnalysis({ excludeIds: draftedPlayerIds });

  // Count drafted players per skill position for the header context strip
  const draftedByPos = useMemo(() => {
    const counts: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const pick of state?.picks ?? []) {
      const pos = pick.player.position;
      if (pos in counts) counts[pos]++;
    }
    return counts;
  }, [state?.picks]);

  const totalDrafted = draftedPlayerIds.size;
  const hasData = curves.length > 0;

  return (
    <div className="h-full overflow-y-auto p-4">
      {/* Header strip: live indicator + drafted counts by position */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <h3 className="text-sm font-semibold text-white">Draft Value — Live</h3>
          <span className="text-xs text-slate-500">
            {season ? `${season} data` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-slate-500">
            {totalDrafted} pick{totalDrafted === 1 ? "" : "s"} made
          </span>
          <div className="flex items-center gap-2">
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <span key={pos} className="flex items-center gap-1">
                <span className="text-slate-600">{pos}</span>
                <span className="font-mono text-slate-400">{draftedByPos[pos]}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Loading state before pool arrives */}
      {loading && !hasData && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-sky-500" />
        </div>
      )}

      {/* Empty state if the backend has no data for the current season */}
      {!loading && !hasData && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">No analytics data available for this season.</p>
        </div>
      )}

      {/* Widget grid */}
      {hasData && (
        <div className="grid grid-cols-12 gap-4">
          <div className="col-span-12 md:col-span-4">
            <DraftPriorityBoard
              priorityBoard={priorityBoard}
              subtitle={totalDrafted === 0 ? "avg VOR of top 5" : "updated live"}
            />
          </div>
          <div className="col-span-12 md:col-span-5">
            <ValueCurvesChart curves={curves} height={180} />
          </div>
          <div className="col-span-12 md:col-span-3">
            <TierBreaksList tierBreaks={tierBreaks} />
          </div>
        </div>
      )}
    </div>
  );
}
