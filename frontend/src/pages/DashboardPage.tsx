import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { apiFetch } from "../api/client";
import type { League } from "../types";

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [leagues, setLeagues] = useState<League[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [leagueName, setLeagueName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");

  const fetchLeagues = async () => {
    const data = await apiFetch<League[]>("/api/leagues");
    setLeagues(data);
  };

  useEffect(() => {
    fetchLeagues();
  }, []);

  const handleCreate = async () => {
    if (!leagueName.trim()) return;
    setError("");
    try {
      const league = await apiFetch<League>("/api/leagues", {
        method: "POST",
        body: JSON.stringify({ name: leagueName.trim() }),
      });
      setShowCreate(false);
      setLeagueName("");
      navigate(`/leagues/${league.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    setError("");
    try {
      const league = await apiFetch<League>("/api/leagues/join", {
        method: "POST",
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      });
      setShowJoin(false);
      setInviteCode("");
      navigate(`/leagues/${league.id}`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const statusStyle = (status: string) => {
    switch (status) {
      case "setup":
        return "bg-amber-500/15 text-amber-400";
      case "drafting":
        return "bg-emerald-500/15 text-emerald-400";
      default:
        return "bg-slate-500/15 text-slate-400";
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Welcome header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">
          Welcome back, <span className="text-sky-400">{user?.username}</span>
        </h1>
        <p className="text-slate-500">Manage your leagues and rankings from here.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {/* Rankings card */}
        <Link
          to="/rankings"
          className="bg-[#1a1d26] border border-white/5 rounded-xl p-6 hover:border-sky-500/30 transition-all group"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-lg bg-sky-500/15 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-sky-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
                <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clipRule="evenodd" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-200 group-hover:text-white transition-colors">
              My Rankings
            </h2>
          </div>
          <p className="text-slate-500 text-sm">
            Create and customize your player rankings for draft day.
          </p>
        </Link>

        {/* Leagues card */}
        <div className="bg-[#1a1d26] border border-white/5 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-emerald-400" viewBox="0 0 20 20" fill="currentColor">
                <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-200">My Leagues</h2>
          </div>

          <div className="flex gap-2 mb-4">
            <button
              onClick={() => { setShowCreate(true); setShowJoin(false); }}
              className="bg-sky-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-sky-500 transition-colors"
            >
              Create League
            </button>
            <button
              onClick={() => { setShowJoin(true); setShowCreate(false); }}
              className="bg-white/5 border border-white/10 text-slate-300 px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
            >
              Join League
            </button>
          </div>

          {showCreate && (
            <div className="space-y-2 mb-4">
              <input
                type="text"
                value={leagueName}
                onChange={(e) => setLeagueName(e.target.value)}
                placeholder="League name"
                className="w-full bg-[#12141b] border border-white/10 rounded-lg px-3.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50"
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <div className="flex gap-2">
                <button onClick={handleCreate} className="bg-sky-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-sky-500 transition-colors">
                  Create
                </button>
                <button onClick={() => setShowCreate(false)} className="text-slate-500 text-sm hover:text-slate-300 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {showJoin && (
            <div className="space-y-2 mb-4">
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="Invite code"
                className="w-full bg-[#12141b] border border-white/10 rounded-lg px-3.5 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50"
                onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              />
              <div className="flex gap-2">
                <button onClick={handleJoin} className="bg-sky-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-sky-500 transition-colors">
                  Join
                </button>
                <button onClick={() => setShowJoin(false)} className="text-slate-500 text-sm hover:text-slate-300 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-2.5 rounded-lg mb-3 text-sm">
              {error}
            </div>
          )}

          {leagues.length === 0 ? (
            <p className="text-slate-600 text-sm py-2">No leagues yet. Create or join one to get started.</p>
          ) : (
            <div className="space-y-2">
              {leagues.map((lg) => (
                <Link
                  key={lg.id}
                  to={`/leagues/${lg.id}`}
                  className="block p-3.5 bg-[#12141b] border border-white/5 rounded-lg hover:border-sky-500/30 transition-all"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-slate-200 text-sm">{lg.name}</span>
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${statusStyle(lg.status)}`}>
                      {lg.status}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1.5">
                    {lg.members.length}/{lg.team_count} teams
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
