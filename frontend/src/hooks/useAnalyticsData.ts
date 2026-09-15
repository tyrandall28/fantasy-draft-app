import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import type {
  PlayerDerivedStats,
  PlayerWeekly,
  SeasonInfo,
  SparklineData,
} from "../types";

/**
 * Shared analytics data hook for the Rankings page contextual panel.
 * Caches position group stats, sparklines, and weekly data per-selection
 * so repeated clicks don't re-hit the API.
 *
 * Exposes two seasons, because "latest" is the wrong answer for some callers:
 *   `season`         - newest season with any data. Good for browsing.
 *   `analysisSeason` - newest *complete* season. Use this anywhere a baseline
 *                      is being computed (VOR, replacement level, tiers);
 *                      one week of games can't support one.
 * Early in a season these differ, and that difference is the whole point.
 */
export function useAnalyticsData() {
  const [seasons, setSeasons] = useState<SeasonInfo[]>([]);
  const [season, setSeason] = useState<number | null>(null);
  const [analysisSeason, setAnalysisSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Caches
  const positionCache = useRef<Map<string, PlayerDerivedStats[]>>(new Map());
  const sparklineCache = useRef<Map<string, SparklineData>>(new Map());
  const weeklyCache = useRef<Map<string, PlayerWeekly[]>>(new Map());

  // Fetch the season inventory once on mount
  useEffect(() => {
    apiFetch<SeasonInfo[]>("/api/analytics/seasons/detail")
      .then((rows) => {
        if (rows.length === 0) return;
        setSeasons(rows);
        setSeason(rows[0].season);
        // Fall back to newest if nothing is complete (e.g. only the current
        // season has been ingested) -- better than showing nothing at all.
        setAnalysisSeason((rows.find((r) => r.is_complete) ?? rows[0]).season);
      })
      .catch(() => {
        setSeason(null);
        setAnalysisSeason(null);
      });
  }, []);

  const fetchPositionData = useCallback(
    async (position: string, seasonArg: number): Promise<PlayerDerivedStats[]> => {
      const key = `${position}-${seasonArg}`;
      const cached = positionCache.current.get(key);
      if (cached) return cached;

      setLoading(true);
      try {
        const params = new URLSearchParams({
          position,
          season: String(seasonArg),
          sort_by: "ppr_per_game",
          sort_dir: "desc",
          min_games: "3",
          limit: "100",
        });
        const data = await apiFetch<PlayerDerivedStats[]>(
          `/api/analytics/position-rankings?${params}`
        );
        positionCache.current.set(key, data);
        return data;
      } catch {
        return [];
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchSparklines = useCallback(
    async (playerIds: number[]): Promise<SparklineData> => {
      if (playerIds.length === 0) return {};
      const key = [...playerIds].sort((a, b) => a - b).join(",");
      const cached = sparklineCache.current.get(key);
      if (cached) return cached;

      try {
        const data = await apiFetch<SparklineData>(
          `/api/analytics/sparklines?player_ids=${playerIds.join(",")}`
        );
        sparklineCache.current.set(key, data);
        return data;
      } catch {
        return {};
      }
    },
    []
  );

  const fetchWeekly = useCallback(
    async (playerId: number, seasonArg: number): Promise<PlayerWeekly[]> => {
      const key = `${playerId}-${seasonArg}`;
      const cached = weeklyCache.current.get(key);
      if (cached) return cached;

      try {
        const data = await apiFetch<PlayerWeekly[]>(
          `/api/players/${playerId}/weekly?season=${seasonArg}`
        );
        weeklyCache.current.set(key, data);
        return data;
      } catch {
        return [];
      }
    },
    []
  );

  return {
    seasons,
    season,
    analysisSeason,
    loading,
    fetchPositionData,
    fetchSparklines,
    fetchWeekly,
  };
}
