import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import type {
  PlayerDerivedStats,
  PlayerWeekly,
  SparklineData,
} from "../types";

/**
 * Shared analytics data hook for the Rankings page contextual panel.
 * Caches position group stats, sparklines, and weekly data per-selection
 * so repeated clicks don't re-hit the API.
 */
export function useAnalyticsData() {
  const [season, setSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  // Caches
  const positionCache = useRef<Map<string, PlayerDerivedStats[]>>(new Map());
  const sparklineCache = useRef<Map<string, SparklineData>>(new Map());
  const weeklyCache = useRef<Map<string, PlayerWeekly[]>>(new Map());

  // Fetch latest available season once on mount
  useEffect(() => {
    apiFetch<number[]>("/api/analytics/seasons")
      .then((seasons) => {
        if (seasons.length > 0) setSeason(seasons[0]);
      })
      .catch(() => setSeason(null));
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
    season,
    loading,
    fetchPositionData,
    fetchSparklines,
    fetchWeekly,
  };
}
