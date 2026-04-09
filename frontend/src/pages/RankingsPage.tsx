import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import type { BaseRankingEntry, UserRanking, UserRankingDetail } from "../types";
import RankingList from "../components/rankings/RankingList";
import SourceSelector from "../components/rankings/SourceSelector";
import SourceComparisonPanel from "../components/rankings/SourceComparisonPanel";
import ContextualAnalyticsPanel from "../components/rankings/ContextualAnalyticsPanel";

type RightPanelMode = "analytics" | "source";

interface RankingSource {
  value: string;
  label: string;
  player_count: number;
}

export default function RankingsPage() {
  const [sources, setSources] = useState<RankingSource[]>([]);
  const [rankings, setRankings] = useState<UserRanking[]>([]);
  const [activeRanking, setActiveRanking] = useState<UserRankingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [comparisonBaseEntries, setComparisonBaseEntries] = useState<BaseRankingEntry[]>([]);
  const [rightPanelMode, setRightPanelMode] = useState<RightPanelMode>("analytics");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);

  const handleComparisonLoaded = useCallback((entries: BaseRankingEntry[]) => {
    setComparisonBaseEntries(entries);
  }, []);

  const handlePlayerSelect = useCallback((playerId: number) => {
    setSelectedPlayerIds((prev) => {
      if (prev.includes(playerId)) {
        return prev.filter((id) => id !== playerId);
      }
      if (prev.length >= 2) {
        // Replace second selection with the new click
        return [prev[0], playerId];
      }
      return [...prev, playerId];
    });
  }, []);

  const handleDeselect = useCallback((playerId: number) => {
    setSelectedPlayerIds((prev) => prev.filter((id) => id !== playerId));
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedPlayerIds([]);
  }, []);

  const fetchSources = async () => {
    const data = await apiFetch<RankingSource[]>("/api/rankings/sources");
    setSources(data);
  };

  const fetchRankings = async () => {
    const data = await apiFetch<UserRanking[]>("/api/rankings");
    setRankings(data);
    setLoading(false);
  };

  const loadRanking = async (id: string) => {
    const data = await apiFetch<UserRankingDetail>(`/api/rankings/${id}`);
    setActiveRanking((prev) => {
      if (prev?.id !== data.id) setSelectedPlayerIds([]);
      return data;
    });
  };

  const createRanking = async (source: string, name: string) => {
    setCreating(true);
    try {
      const data = await apiFetch<UserRanking>("/api/rankings", {
        method: "POST",
        body: JSON.stringify({ source, name }),
      });
      await fetchRankings();
      await loadRanking(data.id);
    } finally {
      setCreating(false);
    }
  };

  const deleteRanking = async (id: string) => {
    await apiFetch(`/api/rankings/${id}`, { method: "DELETE" });
    if (activeRanking?.id === id) setActiveRanking(null);
    await fetchRankings();
  };

  const handleReorder = async (entryIds: number[]) => {
    if (!activeRanking) return;
    await apiFetch(`/api/rankings/${activeRanking.id}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ entry_ids: entryIds }),
    });
    await loadRanking(activeRanking.id);
  };

  const handleToggleLock = async (entryId: number, locked: boolean) => {
    if (!activeRanking) return;
    await apiFetch(`/api/rankings/${activeRanking.id}/entries/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_locked: locked }),
    });
    await loadRanking(activeRanking.id);
  };

  useEffect(() => {
    fetchSources();
    fetchRankings();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sky-500" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-52px)] flex overflow-hidden">
      {/* Left sidebar: user's rankings + create */}
      <div className="w-60 flex-shrink-0 border-r border-white/5 bg-[#12141b] flex flex-col overflow-hidden">
        <div className="p-3 border-b border-white/5 flex-shrink-0">
          <h2 className="font-bold text-white text-sm mb-3">My Rankings</h2>
          <SourceSelector
            sources={sources}
            onCreate={createRanking}
            creating={creating}
          />
        </div>
        <div className="flex-1 overflow-y-auto">
          {rankings.map((r) => (
            <div
              key={r.id}
              className={`px-3 py-2.5 border-b border-white/5 cursor-pointer transition-colors ${
                activeRanking?.id === r.id
                  ? "bg-sky-500/10 border-l-2 border-l-sky-500"
                  : "hover:bg-white/[0.03] border-l-2 border-l-transparent"
              }`}
              onClick={() => loadRanking(r.id)}
            >
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium text-slate-200 text-sm truncate">{r.name}</p>
                  <p className="text-xs text-slate-500">{r.source}</p>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteRanking(r.id);
                  }}
                  className="text-red-400/40 hover:text-red-400 text-xs transition-colors flex-shrink-0 ml-2"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
          {rankings.length === 0 && (
            <p className="text-slate-600 text-sm text-center py-6">
              No rankings yet.
            </p>
          )}
        </div>
      </div>

      {/* Main content: two equal panels side by side */}
      {activeRanking ? (
        <div className="flex-1 flex overflow-hidden">
          {/* Left half: user's custom ranking list */}
          <div className="flex-1 flex flex-col overflow-hidden border-r border-white/5">
            <RankingList
              ranking={activeRanking}
              onReorder={handleReorder}
              onToggleLock={handleToggleLock}
              comparisonBaseEntries={comparisonBaseEntries}
              selectedPlayerIds={selectedPlayerIds}
              onPlayerSelect={handlePlayerSelect}
            />
          </div>

          {/* Right half: contextual analytics OR source comparison */}
          {sources.length > 0 && (
            <div className="flex-1 flex flex-col overflow-hidden bg-[#12141b] relative">
              {/* Mode toggle — floats at top-right of the panel header area */}
              <div className="absolute top-3 right-4 z-10 flex bg-white/5 rounded-lg p-0.5">
                <button
                  onClick={() => setRightPanelMode("analytics")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    rightPanelMode === "analytics"
                      ? "bg-sky-500 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Analytics
                </button>
                <button
                  onClick={() => setRightPanelMode("source")}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    rightPanelMode === "source"
                      ? "bg-sky-500 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  Source
                </button>
              </div>

              {rightPanelMode === "analytics" ? (
                <ContextualAnalyticsPanel
                  entries={activeRanking.entries}
                  comparisonBaseEntries={comparisonBaseEntries}
                  selectedPlayerIds={selectedPlayerIds}
                  onDeselect={handleDeselect}
                  onClearSelection={handleClearSelection}
                />
              ) : (
                <SourceComparisonPanel
                  key={activeRanking.id}
                  sources={sources}
                  userEntries={activeRanking.entries}
                  initialSource={activeRanking.source}
                  onBaseEntriesLoaded={handleComparisonLoaded}
                />
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-slate-500 text-sm">Select or create a ranking to get started.</p>
            <p className="text-slate-600 text-xs mt-2">Your custom list will appear here side-by-side with a source list for comparison.</p>
          </div>
        </div>
      )}
    </div>
  );
}
