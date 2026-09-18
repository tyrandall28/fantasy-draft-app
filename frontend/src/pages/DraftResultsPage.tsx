import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { apiFetch } from "../api/client";
import { usePlayerCard } from "../context/PlayerCardContext";

interface RosterPlayer {
  player_id: number;
  full_name: string;
  position: string;
  nfl_team: string;
  round_num: number;
  overall_pick: number;
}

export default function DraftResultsPage() {
  const { id } = useParams<{ id: string }>();
  const { openPlayerCard } = usePlayerCard();
  const [rosters, setRosters] = useState<Record<string, RosterPlayer[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ rosters: Record<string, RosterPlayer[]> }>(
      `/api/leagues/${id}/draft/results`
    )
      .then((data) => setRosters(data.rosters))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <h1 className="text-2xl font-semibold text-chalk mb-6">Draft Results</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Object.entries(rosters).map(([userId, players]) => (
          <div key={userId} className="panel">
            <div className="p-4 border-b border-ink-600">
              <h3 className="font-semibold text-chalk">Team {userId.slice(0, 8)}</h3>
              <p className="text-xs text-chalk-mut">{players.length} players</p>
            </div>
            <div>
              {players.map((p) => (
                <div
                  key={p.overall_pick}
                  className="flex items-center gap-2 px-4 py-1.5 border-b border-ink-700 text-sm"
                >
                  <span className="text-chalk-mut text-xs w-6 stat-num">R{p.round_num}</span>
                  <span className="font-medium text-xs text-chalk-mut w-8">{p.position}</span>
                  <span
                    className="text-chalk cursor-pointer hover:text-accent transition-colors"
                    onClick={() => openPlayerCard(p.player_id)}
                  >{p.full_name}</span>
                  <span className="text-chalk-dim text-xs ml-auto">{p.nfl_team}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
