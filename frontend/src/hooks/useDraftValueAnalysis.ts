import { useEffect, useMemo, useState } from "react";
import {
  computeAllTiers,
  computePriorityBoard,
  computeVOR,
  DEFAULT_12_TEAM_THRESHOLDS,
  DEFAULT_MIN_GAMES,
  SCORING_POSITIONS,
  type PositionCurve,
  type PositionPriority,
  type PositionTiers,
  type ReplacementThresholds,
} from "../lib/draftValue";
import type { PlayerDerivedStats } from "../types";
import { useAnalyticsData } from "./useAnalyticsData";

interface UseDraftValueAnalysisOptions {
  thresholds?: ReplacementThresholds;
  minGames?: number;
  /** Top N VORs averaged for the priority board. */
  topN?: number;
  /** Tier-break sensitivity — higher = fewer tiers. */
  sigmaK?: number;
  /**
   * Player IDs to remove from the pool before compute runs.
   * Pass `draftedPlayerIds` from DraftContext for a live draft advisor,
   * or leave undefined on the rankings page for the static pre-draft view.
   */
  excludeIds?: Set<number>;
}

interface UseDraftValueAnalysisResult {
  season: number | null;
  loading: boolean;
  curves: PositionCurve[];
  priorityBoard: PositionPriority[];
  tierBreaks: PositionTiers[];
}

/**
 * Fetches the scoring-position player pool and derives draft-value analytics:
 * VOR curves, a priority board, and tier-break detection.
 *
 * Designed so a future useLiveDraftValue hook can reuse the same pure compute
 * functions against a draft-filtered pool. The component consuming this hook
 * should not need to change when that extension lands.
 */
export function useDraftValueAnalysis(
  options: UseDraftValueAnalysisOptions = {}
): UseDraftValueAnalysisResult {
  const { season, fetchPositionData } = useAnalyticsData();
  const [pool, setPool] = useState<PlayerDerivedStats[]>([]);
  const [fetching, setFetching] = useState(false);

  const {
    thresholds = DEFAULT_12_TEAM_THRESHOLDS,
    minGames = DEFAULT_MIN_GAMES,
    topN = 5,
    sigmaK = 1.0,
    excludeIds,
  } = options;

  // Fetch all scoring positions once the season is known
  useEffect(() => {
    if (season == null) return;
    let cancelled = false;
    setFetching(true);
    Promise.all(
      SCORING_POSITIONS.map((pos) => fetchPositionData(pos, season))
    )
      .then((results) => {
        if (cancelled) return;
        // Flatten all positions into one pool for the compute functions
        setPool(results.flat());
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [season, fetchPositionData]);

  const { curves, priorityBoard, tierBreaks } = useMemo(() => {
    if (pool.length === 0) {
      return {
        curves: [] as PositionCurve[],
        priorityBoard: [] as PositionPriority[],
        tierBreaks: [] as PositionTiers[],
      };
    }
    // Filter out drafted players for live-draft mode; no-op on rankings page
    const filteredPool =
      excludeIds && excludeIds.size > 0
        ? pool.filter((p) => !excludeIds.has(p.player_id))
        : pool;
    const curves = computeVOR(filteredPool, { thresholds, minGames });
    const priorityBoard = computePriorityBoard(curves, topN);
    const tierBreaks = computeAllTiers(curves, sigmaK);
    return { curves, priorityBoard, tierBreaks };
  }, [pool, excludeIds, thresholds, minGames, topN, sigmaK]);

  return {
    season,
    loading: fetching,
    curves,
    priorityBoard,
    tierBreaks,
  };
}
