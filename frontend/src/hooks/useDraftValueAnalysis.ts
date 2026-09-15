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
  /** Live curves — computed over the pool minus `excludeIds`. */
  curves: PositionCurve[];
  /**
   * Baseline curves over the full unfiltered pool. Use these (not `curves`)
   * when you need to reason about which drafted players were "elite" — they
   * are by definition missing from the filtered curves.
   */
  baselineCurves: PositionCurve[];
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
  // Deliberately the newest *complete* season, not the newest one with data.
  // Replacement level and tier breaks are baselines: computed off week 1 of an
  // in-progress season they'd be noise, and with a 6-game floor the pool would
  // come back empty and the whole panel would render as "no data".
  const { analysisSeason: season, fetchPositionData } = useAnalyticsData();
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

  // Baseline curves are draft-independent — recompute only when the pool
  // or VOR config changes, not on every pick.
  const baselineCurves = useMemo(() => {
    if (pool.length === 0) return [] as PositionCurve[];
    return computeVOR(pool, { thresholds, minGames });
  }, [pool, thresholds, minGames]);

  const { curves, priorityBoard, tierBreaks } = useMemo(() => {
    if (baselineCurves.length === 0) {
      return {
        curves: [] as PositionCurve[],
        priorityBoard: [] as PositionPriority[],
        tierBreaks: [] as PositionTiers[],
      };
    }
    // No filter → reuse baseline; rankings page hits this path.
    if (!excludeIds || excludeIds.size === 0) {
      return {
        curves: baselineCurves,
        priorityBoard: computePriorityBoard(baselineCurves, topN),
        tierBreaks: computeAllTiers(baselineCurves, sigmaK),
      };
    }
    // Live-draft mode: recompute VOR over the post-draft pool so the
    // replacement threshold tracks scarcity as elites get picked.
    const filteredPool = pool.filter((p) => !excludeIds.has(p.player_id));
    const curves = computeVOR(filteredPool, { thresholds, minGames });
    return {
      curves,
      priorityBoard: computePriorityBoard(curves, topN),
      tierBreaks: computeAllTiers(curves, sigmaK),
    };
  }, [pool, baselineCurves, excludeIds, thresholds, minGames, topN, sigmaK]);

  return {
    season,
    loading: fetching,
    curves,
    baselineCurves,
    priorityBoard,
    tierBreaks,
  };
}
