import { useEffect, useState } from "react";
import { apiFetch } from "../../api/client";
import type { Player } from "../../types";
import PlayerSearchBox from "./PlayerSearchBox";

interface Props {
  /** Positions the caller can show; anyone else is left out of the results. */
  positions: readonly string[];
  onPick: (player: Player) => void;
}

/**
 * Searches every player by name, not just a table on screen, so you don't have
 * to know someone's position to find them.
 *
 * The query lives here rather than in the page on purpose: held by the
 * analytics page, every keystroke re-rendered its 200-row table.
 */
export default function PlayerFinder({ positions, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Player[]>([]);

  // The debounce keeps a fast typist to one request rather than one per key.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let stale = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search: q, limit: "40" });
      apiFetch<Player[]>(`/api/players?${params}`)
        .then((rows) => {
          // The players table also holds offensive linemen, fullbacks and
          // defenses -- positions the caller has nothing to show for.
          if (!stale) setResults(rows.filter((p) => positions.includes(p.position)).slice(0, 8));
        })
        .catch(() => {
          if (!stale) setResults([]);
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [query, positions]);

  const visible = query.trim().length >= 2 ? results : [];

  return (
    <PlayerSearchBox
      value={query}
      onChange={setQuery}
      results={visible.map((p) => ({
        id: p.id,
        name: p.full_name,
        detail: `${p.position} · ${p.nfl_team}`,
      }))}
      onPick={(id) => {
        const pick = results.find((p) => p.id === id);
        if (!pick) return;
        setQuery("");
        setResults([]);
        onPick(pick);
      }}
      placeholder="Find player…"
    />
  );
}
