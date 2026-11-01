import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api/client";
import { useDraft } from "../../context/draft";
import { useDraftValueAnalysis } from "../../hooks/useDraftValueAnalysis";
import type { League } from "../../types";
import {
  DEFAULT_POSITION_SLOTS,
  computeDepletion,
  deriveOpenSlots,
  selectBestAvailable,
  selectSuggestion,
} from "../../lib/draftValue";
import {
  BestAvailableList,
  DepletionStrip,
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
// Human-readable labels for the bot ranking source values stored on the
// League. Used in the transparency strip so users see exactly which list
// the CPUs are drafting from (vs the historical-PPG source powering VOR).
const BOT_SOURCE_LABELS: Record<string, string> = {
  espn_ppr: "ESPN PPR",
  sleeper_ppr: "Sleeper PPR ADP",
};

export default function DraftValuePanel() {
  const { leagueId, state, draftedPlayerIds, myPicks, makePick } = useDraft();

  const { curves, baselineCurves, priorityBoard, tierBreaks, loading, season } =
    useDraftValueAnalysis({ excludeIds: draftedPlayerIds });

  // Pull the league once so the transparency strip can name the bot source.
  // Don't gate the panel on this — it's purely a label.
  const [botSource, setBotSource] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiFetch<League>(`/api/leagues/${leagueId}`)
      .then((lg) => {
        if (!cancelled) setBotSource(lg.bot_ranking_source);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [leagueId]);

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

  // Elite depletion uses the baseline (pre-filter) curves so we can see which
  // drafted players were originally in each position's top-N tier.
  const depletion = useMemo(
    () => computeDepletion(baselineCurves, draftedPlayerIds),
    [baselineCurves, draftedPlayerIds]
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
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rise opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-rise" />
          </span>
          <h3 className="text-sm font-semibold text-chalk">Draft Value — Live</h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-chalk-mut">
            {totalDrafted} pick{totalDrafted === 1 ? "" : "s"} made
          </span>
          <div className="flex items-center gap-2">
            {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
              <span key={pos} className="flex items-center gap-1">
                <span className="text-chalk-mut">{pos}</span>
                <span className="font-mono text-chalk-dim">{draftedByPos[pos]}</span>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Source transparency: spell out which list each side is using so
          users aren't confused when CPU picks differ from our suggestion. */}
      <div className="flex items-center justify-between flex-wrap gap-x-4 gap-y-1 text-[11px] text-chalk-mut -mt-2">
        <span>
          <span className="text-chalk-mut">VOR &amp; suggestion:</span>{" "}
          <span className="text-chalk-dim font-medium">
            {season ? `${season} season PPG (VOR)` : "historical PPG (VOR)"}
          </span>
        </span>
        <span>
          <span className="text-chalk-mut">CPUs draft from:</span>{" "}
          <span className="text-chalk-dim font-medium">
            {botSource ? (BOT_SOURCE_LABELS[botSource] ?? botSource) : "—"}
          </span>
        </span>
      </div>

      {/* Loading state before pool arrives */}
      {loading && !hasData && (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
        </div>
      )}

      {/* Empty state if the backend has no data for the current season */}
      {!loading && !hasData && (
        <div className="text-center py-8">
          <p className="text-sm text-chalk-mut">No analytics data available for this season.</p>
        </div>
      )}

      {/* ── Hero: actionable answer ─────────────────────────────── */}
      {hasData && (
        <>
          {/* Position depletion: how fast each tier is emptying */}
          <div className="panel-inset p-2.5">
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-[10px] uppercase tracking-wide text-chalk-mut font-semibold">
                Elite Depletion
              </span>
              <span className="text-[10px] text-chalk-mut italic">
                top-N drafted by position
              </span>
            </div>
            <DepletionStrip depletion={depletion} inline />
          </div>

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
          <details className="group panel-inset">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-chalk-dim uppercase tracking-wide hover:text-chalk-dim transition-colors flex items-center justify-between">
              <span>Why? · positional context</span>
              <span className="text-[10px] text-chalk-mut group-open:hidden">show</span>
              <span className="text-[10px] text-chalk-mut hidden group-open:inline">hide</span>
            </summary>
            <div className="grid grid-cols-12 gap-4 p-3 border-t border-ink-700">
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
