import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import { usePlayerCard } from "../../context/PlayerCardContext";
import type { BaseRankingEntry, UserRankingEntry } from "../../types";
import { positionBadge } from "../../lib/positionColors";


interface RankingSource {
  value: string;
  label: string;
  player_count?: number;
}

interface Props {
  sources: RankingSource[];
  userEntries: UserRankingEntry[];
  initialSource?: string;
  onBaseEntriesLoaded?: (entries: BaseRankingEntry[]) => void;
}

export default function SourceComparisonPanel({ sources, userEntries, initialSource, onBaseEntriesLoaded }: Props) {
  const { openPlayerCard } = usePlayerCard();
  const [selectedSource, setSelectedSource] = useState(initialSource || sources[0]?.value || "");
  const [baseEntries, setBaseEntries] = useState<BaseRankingEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!selectedSource) return;
    setLoading(true);
    apiFetch<BaseRankingEntry[]>(`/api/players/base-rankings?source=${selectedSource}`)
      .then((entries) => {
        setBaseEntries(entries);
        onBaseEntriesLoaded?.(entries);
      })
      .finally(() => setLoading(false));
  }, [selectedSource]);

  // Build lookup: player_id -> base rank (for analysis)
  const baseRankMap = new Map(baseEntries.map((e) => [e.player_id, e.rank]));

  const filteredBase = filter
    ? baseEntries.filter(
        (e) =>
          e.player.full_name.toLowerCase().includes(filter.toLowerCase()) ||
          e.player.position.toLowerCase().includes(filter.toLowerCase()) ||
          e.player.nfl_team.toLowerCase().includes(filter.toLowerCase())
      )
    : baseEntries;

  // Analysis data: for each player in user's list, calculate rank diff vs source
  const analysisData = userEntries
    .map((entry) => {
      const sourceRank = baseRankMap.get(entry.player_id);
      if (sourceRank === undefined) return null;
      const diff = sourceRank - entry.rank; // positive = user ranks higher, negative = user ranks lower
      return {
        player: entry.player,
        userRank: entry.rank,
        sourceRank,
        diff,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const risers = analysisData.filter((d) => d.diff > 0);
  const fallers = analysisData.filter((d) => d.diff < 0);

  return (
    <div className="flex flex-col h-full">
      {/* Title bar — matches RankingList header height (p-4) */}
      <div className="p-4 border-b border-ink-700 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-bold text-chalk flex items-center gap-2">
            Source Comparison
            <button
              onClick={() => setShowAnalysis(!showAnalysis)}
              className={`text-xs px-3 py-1 rounded-lg font-medium transition-colors ${
                showAnalysis
                  ? "bg-accent text-accent-ink"
                  : "bg-accent/15 text-accent hover:brightness-110/25"
              }`}
            >
              {showAnalysis ? "Show List" : "Analysis"}
            </button>
          </h2>
          <p className="text-xs text-chalk-mut">
            {baseEntries.length} players &middot;{" "}
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="bg-transparent border-none text-xs text-chalk-mut focus:outline-none cursor-pointer hover:text-chalk-dim p-0"
            >
              {sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label} {s.player_count ? `(${s.player_count})` : ""}
                </option>
              ))}
            </select>
          </p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter players..."
          className="panel px-3 py-1.5 text-sm w-48 text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50"
        />
      </div>

      {/* Column header row — matches RankingList header row */}
      <div
        className="grid gap-2 px-4 py-2 text-xs font-semibold text-chalk-mut border-b border-ink-700 flex-shrink-0"
        style={{ gridTemplateColumns: "1fr 4fr 2fr 2fr 1fr" }}
      >
        <div>Rank</div>
        <div>Player</div>
        <div>Position</div>
        <div>Team</div>
        <div>Bye</div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
        </div>
      ) : showAnalysis ? (
        <AnalysisView risers={risers} fallers={fallers} sourceName={sources.find((s) => s.value === selectedSource)?.label || selectedSource} onPlayerClick={openPlayerCard} />
      ) : (
        <div className="flex-1 overflow-y-auto">
          {filteredBase.map((entry) => (
              <div
                key={entry.id}
                className="grid gap-2 px-4 py-2 border-b border-ink-700 items-center text-sm min-h-[40px] hover:bg-ink-700"
                style={{ gridTemplateColumns: "1fr 4fr 2fr 2fr 1fr" }}
              >
                <div className="text-chalk-mut font-mono text-xs">
                  {entry.rank}
                </div>
                <div
                  className="font-medium text-chalk-dim truncate min-w-0 cursor-pointer hover:text-accent transition-colors"
                  onClick={() => openPlayerCard(entry.player.id)}
                >
                  {entry.player.full_name}
                </div>
                <div>
                  <span className={`badge ${positionBadge(entry.player.position)}`}>
                    {entry.player.position}
                  </span>
                </div>
                <div className="text-chalk-mut text-xs">
                  {entry.player.nfl_team}
                </div>
                <div className="text-chalk-mut text-xs">
                  {entry.player.bye_week}
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AnalysisView({
  risers,
  fallers,
  sourceName,
  onPlayerClick,
}: {
  risers: { player: { id: number; full_name: string; position: string; nfl_team: string }; userRank: number; sourceRank: number; diff: number }[];
  fallers: { player: { id: number; full_name: string; position: string; nfl_team: string }; userRank: number; sourceRank: number; diff: number }[];
  sourceName: string;
  onPlayerClick: (playerId: number) => void;
}) {
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-rise/10 border border-rise/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-rise">{risers.length}</p>
          <p className="text-xs text-rise">Ranked Higher</p>
        </div>
        <div className="bg-fall/10 border border-fall/20 rounded-lg p-3 text-center">
          <p className="text-2xl font-bold text-fall">{fallers.length}</p>
          <p className="text-xs text-fall">Ranked Lower</p>
        </div>
      </div>

      <p className="text-xs text-chalk-mut text-center">
        Compared to {sourceName}
      </p>

      {/* Biggest risers */}
      {risers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-rise mb-2 uppercase tracking-wide">
            Biggest Risers (you rank higher)
          </h4>
          <div className="space-y-1">
            {risers.slice(0, 15).map((d) => (
              <div key={`${d.player.full_name}-${d.userRank}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-rise/5 text-sm">
                <span className="text-rise font-mono font-bold w-10 text-right flex-shrink-0 text-xs">
                  +{d.diff}
                </span>
                <span className={`badge flex-shrink-0 ${positionBadge(d.player.position)}`}>
                  {d.player.position}
                </span>
                <span className="text-chalk-dim truncate flex-1 cursor-pointer hover:text-accent transition-colors" onClick={() => onPlayerClick(d.player.id)}>{d.player.full_name}</span>
                <span className="text-chalk-mut text-xs flex-shrink-0">
                  #{d.userRank} vs #{d.sourceRank}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Biggest fallers */}
      {fallers.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-fall mb-2 uppercase tracking-wide">
            Biggest Fallers (you rank lower)
          </h4>
          <div className="space-y-1">
            {fallers.slice(0, 15).map((d) => (
              <div key={`${d.player.full_name}-${d.userRank}`} className="flex items-center gap-2 px-2 py-1.5 rounded bg-fall/5 text-sm">
                <span className="text-fall font-mono font-bold w-10 text-right flex-shrink-0 text-xs">
                  {d.diff}
                </span>
                <span className={`badge flex-shrink-0 ${positionBadge(d.player.position)}`}>
                  {d.player.position}
                </span>
                <span className="text-chalk-dim truncate flex-1 cursor-pointer hover:text-accent transition-colors" onClick={() => onPlayerClick(d.player.id)}>{d.player.full_name}</span>
                <span className="text-chalk-mut text-xs flex-shrink-0">
                  #{d.userRank} vs #{d.sourceRank}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
