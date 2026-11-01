import { useEffect, useMemo, useState } from "react";
import { useAnalyticsData } from "../../hooks/useAnalyticsData";
import type {
  BaseRankingEntry,
  PlayerDerivedStats,
  PlayerWeekly,
  SparklineData,
  UserRankingEntry,
} from "../../types";
import ComparePlayersView from "./ComparePlayersView";
import PositionOverviewView from "./PositionOverviewView";
import SinglePlayerView from "./SinglePlayerView";

const PLAYER_COLORS = ["#4da3ff", "#e0a33e"];

interface Props {
  entries: UserRankingEntry[];
  comparisonBaseEntries?: BaseRankingEntry[];
  selectedPlayerIds: number[];
  onDeselect: (playerId: number) => void;
  onClearSelection: () => void;
}

export default function ContextualAnalyticsPanel({
  entries,
  comparisonBaseEntries,
  selectedPlayerIds,
  onDeselect,
  onClearSelection,
}: Props) {
  const { season, fetchPositionData, fetchSparklines, fetchWeekly } = useAnalyticsData();
  const [positionData, setPositionData] = useState<Map<string, PlayerDerivedStats[]>>(new Map());
  const [sparklines, setSparklines] = useState<SparklineData>({});
  // Weekly keyed by playerId so we can hold both compared players' data at once
  const [weeklyByPlayer, setWeeklyByPlayer] = useState<Map<number, PlayerWeekly[]>>(new Map());
  // The selection whose fetches last finished; anything else is still loading.
  const requestKey = `${selectedPlayerIds.join(",")}|${season}`;
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const loading = selectedPlayerIds.length > 0 && season != null && loadedKey !== requestKey;

  // Resolve selected entries from rankings
  const selectedEntries = useMemo(
    () =>
      selectedPlayerIds
        .map((id) => entries.find((e) => e.player.id === id))
        .filter((e): e is UserRankingEntry => e !== undefined),
    [selectedPlayerIds, entries]
  );

  // Fetch analytics data when selection changes
  useEffect(() => {
    if (selectedPlayerIds.length === 0 || season == null) return;

    let cancelled = false;

    const positions = [...new Set(selectedEntries.map((e) => e.player.position))];
    const tasks: Promise<unknown>[] = [];

    // Position group data (for percentile computation / radar)
    positions.forEach((pos) => {
      tasks.push(
        fetchPositionData(pos, season).then((data) => {
          if (cancelled) return;
          setPositionData((prev) => {
            const next = new Map(prev);
            next.set(pos, data);
            return next;
          });
        })
      );
    });

    // Sparklines for all selected
    tasks.push(
      fetchSparklines(selectedPlayerIds).then((data) => {
        if (cancelled) return;
        setSparklines((prev) => ({ ...prev, ...data }));
      })
    );

    // Weekly data for every selected player (1 or 2)
    selectedPlayerIds.forEach((pid) => {
      tasks.push(
        fetchWeekly(pid, season).then((data) => {
          if (cancelled) return;
          setWeeklyByPlayer((prev) => {
            const next = new Map(prev);
            next.set(pid, data);
            return next;
          });
        })
      );
    });

    Promise.all(tasks).finally(() => {
      if (!cancelled) setLoadedKey(requestKey);
    });

    return () => {
      cancelled = true;
    };
  }, [selectedPlayerIds, season, selectedEntries, fetchPositionData, fetchSparklines, fetchWeekly, requestKey]);

  // Build lookups for rendering
  const getPlayerStats = (playerId: number, position: string): PlayerDerivedStats | null => {
    const group = positionData.get(position);
    if (!group) return null;
    return group.find((p) => p.player_id === playerId) ?? null;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-ink-700 flex items-center justify-between flex-shrink-0 min-h-[72px]">
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-chalk">Analytics</h2>
          <p className="text-xs text-chalk-mut">
            {selectedPlayerIds.length === 0
              ? "Click a player to explore"
              : selectedPlayerIds.length === 1
              ? "Click another to compare"
              : "Comparing 2 players"}
          </p>
        </div>

        {/* Selected player pills */}
        {selectedEntries.length > 0 && (
          <div className="flex items-center gap-2">
            {selectedEntries.map((e, i) => (
              <span
                key={e.player.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium max-w-[120px]"
                style={{
                  backgroundColor: PLAYER_COLORS[i] + "22",
                  color: PLAYER_COLORS[i],
                  border: `1px solid ${PLAYER_COLORS[i]}44`,
                }}
              >
                <span className="truncate">{e.player.full_name}</span>
                <button
                  onClick={() => onDeselect(e.player.id)}
                  className="text-[10px] hover:opacity-70 flex-shrink-0"
                  title="Remove"
                >
                  ✕
                </button>
              </span>
            ))}
            {selectedEntries.length > 1 && (
              <button
                onClick={onClearSelection}
                className="text-xs text-chalk-mut hover:text-chalk-dim px-2"
                title="Clear all"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      {/* Body: conditional rendering based on selection count */}
      {selectedEntries.length === 0 && (
        <PositionOverviewView
          entries={entries}
          comparisonBaseEntries={comparisonBaseEntries}
        />
      )}

      {selectedEntries.length === 1 && (
        <SinglePlayerView
          entry={selectedEntries[0]}
          stats={getPlayerStats(selectedEntries[0].player.id, selectedEntries[0].player.position)}
          positionGroup={positionData.get(selectedEntries[0].player.position) ?? []}
          sparkline={sparklines[selectedEntries[0].player.id] ?? []}
          weekly={weeklyByPlayer.get(selectedEntries[0].player.id) ?? []}
          loading={loading}
        />
      )}

      {selectedEntries.length === 2 && (
        <ComparePlayersView
          loading={loading}
          players={selectedEntries.map((entry) => ({
            entry,
            stats: getPlayerStats(entry.player.id, entry.player.position),
            sparkline: sparklines[entry.player.id] ?? [],
            weekly: weeklyByPlayer.get(entry.player.id) ?? [],
            positionGroup: positionData.get(entry.player.position) ?? [],
          }))}
        />
      )}
    </div>
  );
}
