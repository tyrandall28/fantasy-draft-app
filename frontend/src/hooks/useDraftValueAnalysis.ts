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
    const curves = computeVOR(pool, { thresholds, minGames });
    const priorityBoard = computePriorityBoard(curves, topN);
    const tierBreaks = computeAllTiers(curves, sigmaK);
    return { curves, priorityBoard, tierBreaks };
  }, [pool, thresholds, minGames, topN, sigmaK]);

  return {
    season,
    loading: fetching,
    curves,
    priorityBoard,
    tierBreaks,
  };
}
