import { useMemo } from "react";
import { useDraft } from "../../context/DraftContext";
import { useDraftValueAnalysis } from "../../hooks/useDraftValueAnalysis";
import {
  DEFAULT_POSITION_SLOTS,
  deriveOpenSlots,
  selectBestAvailable,
  selectSuggestion,
} from "../../lib/draftValue";
import {
  BestAvailableList,
  DraftPriorityBoard,
  SuggestionCard,
  TierBreaksList,
  ValueCurvesChart,
} from "../analytics/draftValueWidgets";

/**
 * Live draft-value advisor. Tier 1.5 layout: the actionable answer
 * (suggestion card + best-available list) is the hero; the macro
 * widgets (priority, curves, tiers) are demoted to a collapsible
 * "why" strip below.
 */
export default function DraftValuePanel() {
  const { state, draftedPlayerIds, myPicks, makePick } = useDraft();

  const { curves, priorityBoard, tierBreaks, loading, season } =
    useDraftValueAnalysis({ excludeIds: draftedPlayerIds });

  // Open starter slots derived from the user's picks so far
  const openSlots = useMemo(
    () => deriveOpenSlots(myPicks, DEFAULT_POSITION_SLOTS),
    [myPicks]
  );

  // Cross-position best-available ranking (Tier 1.5 hero data)
  const bestAvailable = useMemo(
    () => selectBestAvailable(curves, 25),
    [curves]
  );

  const suggestion = useMemo(
    () => selectSuggestion(bestAvailable, openSlots, DEFAULT_POSITION_SLOTS),
    [bestAvailable, openSlots]
  );

  // Detect whether it's the current user's turn
  const isMyTurn = useMemo(() => {
    if (!state) return false;
    if (state.status !== "drafting") return false;
    const userId = localStorage.getItem("user_id");
    return state.current_user_id === userId;
  }, [state]);

  // Drafted counts per skill position for the header strip
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
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header strip: live indicator + drafted counts by position */}
      <div className="flex items-center justify-between flex-wrap gap-3">
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

      {/* ── Hero: actionable answer ─────────────────────────────── */}
      {hasData && (
        <>
          <SuggestionCard
            suggestion={suggestion}
            isMyTurn={isMyTurn}
            onPick={makePick}
          />

          <BestAvailableList
            players={bestAvailable}
            openSlots={openSlots}
            positionSlots={DEFAULT_POSITION_SLOTS}
            highlightId={suggestion?.player.player.player_id}
            onPick={makePick}
            isMyTurn={isMyTurn}
          />

          {/* ── Context strip: the "why" behind the suggestion ───── */}
          <details className="group rounded-lg border border-white/5 bg-white/[0.02]">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide hover:text-slate-200 transition-colors flex items-center justify-between">
              <span>Why? · positional context</span>
              <span className="text-[10px] text-slate-600 group-open:hidden">show</span>
              <span className="text-[10px] text-slate-600 hidden group-open:inline">hide</span>
            </summary>
            <div className="grid grid-cols-12 gap-4 p-3 border-t border-white/5">
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
          </details>
        </>
      )}
    </div>
  );
}
