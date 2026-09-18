import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import { usePlayerCard } from "../../context/PlayerCardContext";
import type { Player, UserRanking, UserRankingDetail } from "../../types";
import { positionBadge } from "../../lib/positionColors";


interface Props {
  draftedPlayerIds: Set<number>;
  onPick: (playerId: number) => void;
  canPick: boolean;
}

export default function AvailablePlayerList({ draftedPlayerIds, onPick, canPick }: Props) {
  const { openPlayerCard } = usePlayerCard();
  const [rankings, setRankings] = useState<UserRanking[]>([]);
  const [selectedRankingId, setSelectedRankingId] = useState<string>("");
  const [rankingDetail, setRankingDetail] = useState<UserRankingDetail | null>(null);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState("");

  // Load user's ranking lists
  useEffect(() => {
    apiFetch<UserRanking[]>("/api/rankings").then((data) => {
      setRankings(data);
      if (data.length > 0) {
        setSelectedRankingId(data[0].id);
      }
    });
    // Also load all players as fallback
    apiFetch<Player[]>("/api/players").then(setAllPlayers);
  }, []);

  // Load ranking detail when selection changes
  useEffect(() => {
    if (!selectedRankingId) {
      setRankingDetail(null);
      return;
    }
    apiFetch<UserRankingDetail>(`/api/rankings/${selectedRankingId}`)
      .then(setRankingDetail)
      .catch(() => setRankingDetail(null));
  }, [selectedRankingId]);

  // Build the player list: use ranking order if available, fallback to all players
  const playerList: { id: number; full_name: string; position: string; nfl_team: string; bye_week: number | null; rank?: number }[] = [];

  if (rankingDetail) {
    for (const entry of rankingDetail.entries) {
      if (!draftedPlayerIds.has(entry.player_id)) {
        playerList.push({ ...entry.player, rank: entry.rank });
      }
    }
  } else {
    for (const p of allPlayers) {
      if (!draftedPlayerIds.has(p.id)) {
        playerList.push(p);
      }
    }
  }

  const filtered = playerList.filter(
    (p) =>
      (!posFilter || p.position === posFilter) &&
      (!search || p.full_name.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="bg-ink-800 flex flex-col h-full">
      <div className="p-3 border-b border-ink-700">
        {/* Ranking selector */}
        <select
          value={selectedRankingId}
          onChange={(e) => setSelectedRankingId(e.target.value)}
          className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1.5 text-sm text-chalk-dim focus:outline-none focus:border-accent mb-2"
        >
          <option value="">All Players (no ranking)</option>
          {rankings.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 text-sm text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:border-accent mb-2"
        />
        <div className="flex gap-1 flex-wrap">
          {["", "QB", "RB", "WR", "TE", "K", "DST"].map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                posFilter === pos
                  ? "bg-accent text-accent-ink"
                  : "bg-ink-700 text-chalk-dim hover:bg-ink-600"
              }`}
            >
              {pos || "All"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-chalk-mut mt-1.5">
          {filtered.length} available
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between px-3 py-2 border-b border-ink-700 hover:bg-ink-700 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {p.rank != null && (
                <span className="text-[10px] text-chalk-mut w-5 text-right font-mono flex-shrink-0">
                  {p.rank}
                </span>
              )}
              <span className={`badge-sm flex-shrink-0 ${positionBadge(p.position)}`}>
                {p.position}
              </span>
              <div className="min-w-0">
                <p
                  className="text-xs font-medium text-chalk-dim truncate cursor-pointer hover:text-accent transition-colors"
                  onClick={() => openPlayerCard(p.id)}
                >
                  {p.full_name}
                </p>
                <p className="text-[10px] text-chalk-mut">{p.nfl_team}{p.bye_week ? ` · Bye ${p.bye_week}` : ""}</p>
              </div>
            </div>
            <button
              onClick={() => onPick(p.id)}
              disabled={!canPick}
              className="btn-primary text-[10px] px-2.5 py-1 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex-shrink-0 ml-2"
            >
              Draft
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
