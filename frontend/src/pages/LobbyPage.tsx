import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { errorMessage } from "../lib/errors";
import { useAuth } from "../context/auth";
import { usePlayerCard } from "../context/playerCard";
import type { League, UserRanking, UserRankingDetail } from "../types";
import BottomPanel from "../components/draft/BottomPanel";
import { positionBadge } from "../lib/positionColors";


const POSITION_ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "DST", "BN"];

export default function LobbyPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { openPlayerCard } = usePlayerCard();
  const navigate = useNavigate();
  const [league, setLeague] = useState<League | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);
  const [addingBot, setAddingBot] = useState(false);

  // Rankings state
  const [rankings, setRankings] = useState<UserRanking[]>([]);
  const [selectedRankingId, setSelectedRankingId] = useState<string>("");
  const [fetchedDetail, setFetchedDetail] = useState<UserRankingDetail | null>(null);
  // Only the list that's selected right now -- never the one before it while
  // the new one is still loading.
  const rankingDetail =
    fetchedDetail && fetchedDetail.id === selectedRankingId ? fetchedDetail : null;
  const [rankingSearch, setRankingSearch] = useState("");
  const [rankingPosFilter, setRankingPosFilter] = useState("");

  const fetchLeague = useCallback(async () => {
    try {
      const data = await apiFetch<League>(`/api/leagues/${id}`);
      setLeague(data);
      if (data.status === "drafting" || data.status === "completed") {
        navigate(`/draft/${id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    fetchLeague();
    const interval = setInterval(fetchLeague, 5000);
    return () => clearInterval(interval);
  }, [fetchLeague]);

  useEffect(() => {
    apiFetch<UserRanking[]>("/api/rankings").then(setRankings).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedRankingId) return;
    apiFetch<UserRankingDetail>(`/api/rankings/${selectedRankingId}`)
      .then(setFetchedDetail)
      .catch(() => setFetchedDetail(null));
  }, [selectedRankingId]);

  useEffect(() => {
    if (selectedRankingId && id) {
      apiFetch(`/api/leagues/${id}/members/me`, {
        method: "PATCH",
        body: JSON.stringify({ ranking_id: selectedRankingId }),
      }).catch(() => {});
    }
  }, [selectedRankingId, id]);

  useEffect(() => {
    if (league && user) {
      const me = league.members.find((m) => m.user_id === user.id);
      // Adopt the ranking saved on the server, but never over one picked here.
      const saved = me?.ranking_id;
      if (saved) setSelectedRankingId((current) => current || saved);
    }
  }, [league, user]);

  const handleCopyInvite = () => {
    if (!league) return;
    navigator.clipboard.writeText(league.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleAddBot = async () => {
    setAddingBot(true);
    try {
      await apiFetch(`/api/leagues/${id}/bots`, { method: "POST" });
      await fetchLeague();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAddingBot(false);
    }
  };

  const handleRemoveBot = async (botUserId: string) => {
    try {
      await apiFetch(`/api/leagues/${id}/bots/${botUserId}`, { method: "DELETE" });
      await fetchLeague();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleStartDraft = async () => {
    setStarting(true);
    setError("");
    try {
      await apiFetch(`/api/leagues/${id}/draft/start`, { method: "POST" });
      navigate(`/draft/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      setStarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-ink-900">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
      </div>
    );
  }

  if (!league) {
    return <div className="min-h-screen bg-ink-900 text-fall p-6 whitespace-pre-line">{error || "League not found"}</div>;
  }

  const teamCount = league.team_count;
  const rounds = league.roster_size;

  // Build position slots: position 1..N, with the member who claimed it (if any)
  const positionSlots: { position: number; member: typeof league.members[0] | null }[] = [];
  for (let pos = 1; pos <= teamCount; pos++) {
    const member = league.members.find((m) => m.draft_position === pos) ?? null;
    positionSlots.push({ position: pos, member });
  }

  const myPosition = league.members.find((m) => m.user_id === user?.id)?.draft_position ?? null;

  const handleClaimPosition = async (pos: number) => {
    try {
      await apiFetch(`/api/leagues/${id}/claim-position`, {
        method: "POST",
        body: JSON.stringify({ position: myPosition === pos ? null : pos }),
      });
      await fetchLeague();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const isCommissioner = user?.id === league.commissioner_id;

  const updateSetting = async (patch: Record<string, unknown>) => {
    try {
      const updated = await apiFetch<League>(`/api/leagues/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      setLeague(updated);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const updatePositionSlot = (pos: string, count: number) => {
    const newSlots = { ...league.position_slots, [pos]: count };
    const rosterSize = Object.values(newSlots).reduce((a, b) => a + (b as number), 0);
    const benchSize = newSlots["BN"] ?? 0;
    updateSetting({ position_slots: newSlots, roster_size: rosterSize, bench_size: benchSize });
  };

  // For the draft board preview, build columns from positions
  const columns = positionSlots.map((slot) => ({
    uid: slot.member?.user_id ?? null,
    label: slot.member?.team_name || slot.member?.username || `Open ${slot.position}`,
    isBot: slot.member?.is_bot ?? false,
  }));

  const filteredEntries = rankingDetail?.entries.filter(
    (e) =>
      (!rankingPosFilter || e.player.position === rankingPosFilter) &&
      (!rankingSearch || e.player.full_name.toLowerCase().includes(rankingSearch.toLowerCase()))
  ) || [];

  return (
    <div className="h-screen bg-ink-900 text-chalk flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="bg-ink-800 border-b border-ink-700 px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/"
            className="text-chalk-dim hover:text-chalk-dim transition-colors"
            title="Back to Dashboard"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
            </svg>
          </Link>
          <h1 className="text-lg font-bold text-chalk">{league.name}</h1>
          <span className="text-xs text-chalk-dim">
            {league.scoring_type.toUpperCase()} &middot; {teamCount} teams ({league.members.length} joined) &middot; {league.roster_size} rounds &middot; {league.pick_time_seconds === 0 ? "No timer" : league.pick_time_seconds >= 120 ? `${league.pick_time_seconds / 60}min/pick` : `${league.pick_time_seconds}s/pick`}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <code className="bg-ink-700 px-2 py-1 rounded text-xs font-mono text-chalk-dim border border-ink-600">
              {league.invite_code}
            </code>
            <button
              onClick={handleCopyInvite}
              className="btn-primary px-2.5 py-1 text-xs"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {/* Starting the draft is the commissioner's, like every other
              setting here. The button used to be offered to everyone and the
              server now refuses it, so say who it's waiting on instead. */}
          {league.status === "setup" &&
            (isCommissioner ? (
              <button
                onClick={handleStartDraft}
                disabled={starting}
                className="bg-rise text-chalk px-5 py-1.5 rounded-lg text-sm font-bold hover:bg-rise disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {starting ? "Starting..." : "Start Draft"}
              </button>
            ) : (
              <span className="text-xs text-chalk-mut">
                Waiting for the commissioner to start
              </span>
            ))}
        </div>
      </div>

      {error && <div className="bg-fall/10 text-fall px-4 py-2 text-sm border-b border-fall/20 whitespace-pre-line">{error}</div>}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
      {/* Top: 3-column area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar: Rankings */}
        <div className="w-72 flex-shrink-0 bg-ink-800 border-r border-ink-700 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-ink-700">
            <h3 className="font-semibold text-chalk-dim text-sm mb-2">My Rankings</h3>
            <select
              value={selectedRankingId}
              onChange={(e) => setSelectedRankingId(e.target.value)}
              className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1.5 text-sm text-chalk-dim focus:outline-none focus:border-accent"
            >
              <option value="">Select a ranking list...</option>
              {rankings.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.source})
                </option>
              ))}
            </select>
            {rankings.length === 0 && (
              <p className="text-xs text-chalk-mut mt-2">
                No rankings yet. Create one from the Rankings page.
              </p>
            )}
          </div>

          {rankingDetail && (
            <>
              <div className="p-3 border-b border-ink-700">
                <input
                  type="text"
                  value={rankingSearch}
                  onChange={(e) => setRankingSearch(e.target.value)}
                  placeholder="Search players..."
                  className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 text-sm text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:border-accent mb-2"
                />
                <div className="flex gap-1 flex-wrap">
                  {["", "QB", "RB", "WR", "TE", "K", "DST"].map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setRankingPosFilter(pos)}
                      className={`text-xs px-2 py-0.5 rounded transition-colors ${
                        rankingPosFilter === pos
                          ? "bg-accent text-accent-ink"
                          : "bg-ink-700 text-chalk-dim hover:bg-ink-600"
                      }`}
                    >
                      {pos || "All"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center gap-2 px-3 py-1.5 border-b border-ink-700 hover:bg-ink-700 transition-colors"
                  >
                    <span className="text-[10px] text-chalk-mut w-5 text-right font-mono">{entry.rank}</span>
                    <span className={`badge-sm ${positionBadge(entry.player.position)}`}>
                      {entry.player.position}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-xs font-medium text-chalk-dim truncate cursor-pointer hover:text-accent transition-colors"
                        onClick={() => openPlayerCard(entry.player_id)}
                      >{entry.player.full_name}</p>
                      <p className="text-[10px] text-chalk-mut">{entry.player.nfl_team}</p>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Center: Draft Board */}
        <div className="flex-1 overflow-hidden p-3">
          <div className="bg-ink-700 rounded-xl overflow-hidden h-full flex flex-col">
            <div className="overflow-auto flex-1">
              <table className="w-full border-collapse text-xs table-fixed" style={{ minWidth: `${Math.max(columns.length * 120, 600)}px` }}>
                <colgroup>
                  <col style={{ width: "40px" }} />
                  {columns.map((_, i) => (
                    <col key={i} style={{ width: `${100 / columns.length}%` }} />
                  ))}
                </colgroup>
                <thead className="sticky top-0 z-10">
                  <tr className="bg-ink-800">
                    <th className="py-2.5 px-2 text-chalk-mut font-medium text-center sticky left-0 bg-ink-800 z-20">
                      RD
                    </th>
                    {positionSlots.map((slot) => {
                      const isMe = slot.member?.user_id === user?.id;
                      const isEmpty = !slot.member;
                      const isBot = slot.member?.is_bot;
                      const canClaim = league.status === "setup" && !isBot;
                      return (
                        <th
                          key={slot.position}
                          className={`py-2.5 px-1 font-semibold text-center ${
                            isMe ? "text-accent" : isBot ? "text-caution" : isEmpty ? "text-chalk-mut" : "text-chalk-dim"
                          }`}
                        >
                          {canClaim ? (
                            <button
                              onClick={() => handleClaimPosition(slot.position)}
                              className={`truncate w-full rounded px-1 py-0.5 transition-colors ${
                                isEmpty
                                  ? "hover:brightness-110/10 hover:text-accent text-chalk-mut"
                                  : isMe
                                    ? "hover:bg-fall/10 text-accent"
                                    : ""
                              }`}
                              title={isEmpty ? `Claim position ${slot.position}` : isMe ? "Release position" : ""}
                            >
                              {isEmpty ? `Pick ${slot.position}` : slot.member?.team_name || `Team ${slot.position}`}
                            </button>
                          ) : (
                            <div className="truncate">
                              {slot.member?.team_name || `Pick ${slot.position}`}
                              {isBot && <span className="text-[9px] ml-1 opacity-60">CPU</span>}
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: rounds }, (_, roundIdx) => {
                    const roundNum = roundIdx + 1;
                    const isEven = roundNum % 2 === 0;
                    const rowBg = roundNum % 2 === 0 ? "#232320" : "#232320";

                    return (
                      <tr key={roundNum} style={{ backgroundColor: rowBg }}>
                        <td className="py-0 px-2 text-chalk-mut text-center font-mono font-medium sticky left-0 z-10" style={{ backgroundColor: rowBg }}>
                          {roundNum}
                        </td>
                        {columns.map((col, colIdx) => {
                          const pickIdx = isEven ? teamCount - 1 - colIdx : colIdx;
                          const overall = roundIdx * teamCount + pickIdx + 1;
                          const isMyCol = col.uid === user?.id;

                          return (
                            <td key={colIdx} className="p-[2px]">
                              <div
                                className={`rounded-md h-[56px] flex flex-col items-start justify-center px-2.5 border-l-[3px] ${
                                  isMyCol
                                    ? "border-l-accent/40 bg-accent/5"
                                    : "border-l-transparent bg-ink-700"
                                }`}
                              >
                                <span className="text-[10px] font-mono text-chalk-mut">{overall}</span>
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right sidebar: Members */}
        <div className="w-56 flex-shrink-0 bg-ink-800 border-l border-ink-700 flex flex-col overflow-hidden">
          <div className="p-3 border-b border-ink-700 flex items-center justify-between">
            <h3 className="font-semibold text-chalk-dim text-sm">
              Members ({league.members.length}/{teamCount})
            </h3>
            {league.status === "setup" && user?.id === league.commissioner_id && league.members.length < teamCount && (
              <button
                onClick={handleAddBot}
                disabled={addingBot}
                className="text-[10px] font-medium bg-rise/15 text-rise px-2 py-0.5 rounded hover:bg-rise/25 transition-colors disabled:opacity-50"
              >
                {addingBot ? "..." : "+ CPU"}
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {league.members
              .sort((a, b) => (a.draft_position ?? 99) - (b.draft_position ?? 99))
              .map((m) => (
                <div
                  key={m.user_id}
                  className={`flex items-center gap-2 p-2 rounded-lg transition-colors ${
                    m.user_id === user?.id
                      ? "bg-accent/10"
                      : m.is_bot
                        ? "bg-caution/5"
                        : "bg-ink-700"
                  }`}
                >
                  {m.draft_position != null && (
                    <span className="bg-accent/20 text-accent text-[10px] font-bold w-5 h-5 flex items-center justify-center rounded-full flex-shrink-0">
                      {m.draft_position}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-chalk-dim text-xs truncate flex items-center gap-1">
                      {m.team_name}
                      {m.is_bot && (
                        <span className="text-[9px] bg-caution/20 text-caution px-1 py-0.5 rounded font-semibold">
                          CPU
                        </span>
                      )}
                    </p>
                    <p className="text-[10px] text-chalk-mut truncate">
                      {m.is_bot ? "Computer" : m.username}
                      {m.user_id === league.commissioner_id && " (Comm.)"}
                    </p>
                  </div>
                  {m.is_bot && league.status === "setup" && user?.id === league.commissioner_id && (
                    <button
                      onClick={() => handleRemoveBot(m.user_id)}
                      className="text-fall/40 hover:text-fall text-xs transition-colors flex-shrink-0"
                      title="Remove CPU"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
          </div>

          {/* League Settings */}
          <div className="p-3 border-t border-ink-700 overflow-y-auto">
            <h4 className="font-medium text-chalk-dim text-[10px] uppercase tracking-wider mb-2">
              League Settings
              {!isCommissioner && <span className="text-chalk-mut normal-case tracking-normal ml-1">(view only)</span>}
            </h4>
            <div className="space-y-2.5 text-[10px]">
              {/* League Name */}
              <div>
                <label className="text-chalk-mut block mb-1">League Name</label>
                {isCommissioner && league.status === "setup" ? (
                  <input
                    type="text"
                    defaultValue={league.name}
                    onBlur={(e) => {
                      const val = e.target.value.trim();
                      if (val && val !== league.name) updateSetting({ name: val });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    className="w-full bg-ink-700 border border-ink-600 rounded px-1.5 py-1 text-[10px] text-chalk-dim focus:outline-none focus:border-accent"
                  />
                ) : (
                  <p className="text-chalk-dim">{league.name}</p>
                )}
              </div>

              {/* Team Count */}
              <div>
                <label className="text-chalk-mut block mb-1">Teams</label>
                {isCommissioner && league.status === "setup" ? (
                  <select
                    value={league.team_count}
                    onChange={(e) => updateSetting({ team_count: Number(e.target.value) })}
                    className="w-full bg-ink-700 border border-ink-600 rounded px-1.5 py-1 text-[10px] text-chalk-dim focus:outline-none focus:border-accent"
                  >
                    {[6, 8, 10, 12, 14].map((n) => (
                      <option key={n} value={n}>{n} Teams</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-chalk-dim">{league.team_count} Teams</p>
                )}
              </div>

              {/* Pick Timer */}
              <div>
                <label className="text-chalk-mut block mb-1">Pick Timer</label>
                {isCommissioner && league.status === "setup" ? (
                  <select
                    value={league.pick_time_seconds}
                    onChange={(e) => updateSetting({ pick_time_seconds: Number(e.target.value) })}
                    className="w-full bg-ink-700 border border-ink-600 rounded px-1.5 py-1 text-[10px] text-chalk-dim focus:outline-none focus:border-accent"
                  >
                    <option value={30}>30 seconds</option>
                    <option value={60}>60 seconds</option>
                    <option value={90}>90 seconds</option>
                    <option value={120}>2 minutes</option>
                    <option value={300}>5 minutes</option>
                    <option value={0}>No timer</option>
                  </select>
                ) : (
                  <p className="text-chalk-dim">{league.pick_time_seconds === 0 ? "No timer" : `${league.pick_time_seconds}s`}</p>
                )}
              </div>

              {/* Position Slots */}
              <div>
                <label className="text-chalk-mut block mb-1">Roster Slots</label>
                <div className="space-y-1">
                  {POSITION_ORDER.map((pos) => {
                    const count = league.position_slots[pos] ?? 0;
                    return (
                      <div key={pos} className="flex items-center justify-between">
                        <span className={`font-bold px-1.5 py-0.5 rounded ${positionBadge(pos)}`}>
                          {pos}
                        </span>
                        {isCommissioner && league.status === "setup" ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => updatePositionSlot(pos, Math.max(0, count - 1))}
                              className="w-5 h-5 rounded bg-ink-700 text-chalk-dim hover:bg-ink-600 hover:text-chalk flex items-center justify-center transition-colors text-xs font-bold"
                            >
                              −
                            </button>
                            <span className="text-chalk-dim w-4 text-center font-mono">{count}</span>
                            <button
                              onClick={() => updatePositionSlot(pos, count + 1)}
                              className="w-5 h-5 rounded bg-ink-700 text-chalk-dim hover:bg-ink-600 hover:text-chalk flex items-center justify-center transition-colors text-xs font-bold"
                            >
                              +
                            </button>
                          </div>
                        ) : (
                          <span className="text-chalk-dim font-mono">{count}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-ink-700">
                  <span className="text-chalk-dim font-medium">Draft Rounds</span>
                  <span className="text-chalk-dim font-mono font-bold">{Object.values(league.position_slots).reduce((a: number, b: unknown) => a + (b as number), 0)}</span>
                </div>
              </div>

              {/* CPU Ranking Source */}
              {league.members.some((m) => m.is_bot) && (
                <div>
                  <label className="text-chalk-mut block mb-1">CPU Ranking Source</label>
                  {isCommissioner && league.status === "setup" ? (
                    <select
                      value={league.bot_ranking_source}
                      onChange={(e) => updateSetting({ bot_ranking_source: e.target.value })}
                      className="w-full bg-ink-700 border border-ink-600 rounded px-1.5 py-1 text-[10px] text-chalk-dim focus:outline-none focus:border-accent"
                    >
                      <option value="espn_ppr">ESPN PPR</option>
                      <option value="sleeper_ppr">Sleeper PPR ADP</option>
                    </select>
                  ) : (
                    <p className="text-chalk-dim">{league.bot_ranking_source === "espn_ppr" ? "ESPN PPR" : "Sleeper PPR ADP"}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Tabbed panel */}
      <BottomPanel picks={[]} />
      </div>
    </div>
  );
}
