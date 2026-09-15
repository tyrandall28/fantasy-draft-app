import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import { usePlayerCard } from "../../context/PlayerCardContext";
import type { Player, UserRanking, UserRankingDetail } from "../../types";

const POS_BADGE: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-emerald-500/20 text-emerald-400",
  WR: "bg-sky-500/20 text-sky-400",
  TE: "bg-amber-500/20 text-amber-400",
  K: "bg-purple-500/20 text-purple-400",
  DST: "bg-slate-500/20 text-slate-400",
};

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
    <div className="bg-[#12141b] flex flex-col h-full">
      <div className="p-3 border-b border-white/5">
        {/* Ranking selector */}
        <select
          value={selectedRankingId}
          onChange={(e) => setSelectedRankingId(e.target.value)}
          className="w-full bg-[#1a1d26] border border-white/10 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500 mb-2"
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
          className="w-full bg-[#1a1d26] border border-white/10 rounded px-2 py-1 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-500 mb-2"
        />
        <div className="flex gap-1 flex-wrap">
          {["", "QB", "RB", "WR", "TE", "K", "DST"].map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`text-xs px-2 py-0.5 rounded transition-colors ${
                posFilter === pos
                  ? "bg-sky-600 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10"
              }`}
            >
              {pos || "All"}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-slate-500 mt-1.5">
          {filtered.length} available
        </p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {filtered.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between px-3 py-2 border-b border-white/5 hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-2 min-w-0">
              {p.rank != null && (
                <span className="text-[10px] text-slate-500 w-5 text-right font-mono flex-shrink-0">
                  {p.rank}
                </span>
              )}
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0 ${POS_BADGE[p.position] ?? "bg-slate-500/20 text-slate-400"}`}>
                {p.position}
              </span>
              <div className="min-w-0">
                <p
                  className="text-xs font-medium text-slate-200 truncate cursor-pointer hover:text-sky-400 transition-colors"
                  onClick={() => openPlayerCard(p.id)}
                >
                  {p.full_name}
                </p>
                <p className="text-[10px] text-slate-500">{p.nfl_team}{p.bye_week ? ` · Bye ${p.bye_week}` : ""}</p>
              </div>
            </div>
            <button
              onClick={() => onPick(p.id)}
              disabled={!canPick}
              className="bg-sky-600 text-white text-[10px] px-2.5 py-1 rounded font-medium hover:bg-sky-500 disabled:opacity-20 disabled:cursor-not-allowed transition-colors flex-shrink-0 ml-2"
            >
              Draft
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
