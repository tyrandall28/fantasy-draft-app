import { useCallback, useState, type ReactNode } from "react";
import PlayerCard from "../components/PlayerCard";
import { PlayerCardContext } from "./playerCard";

export function PlayerCardProvider({ children }: { children: ReactNode }) {
  const [playerId, setPlayerId] = useState<number | null>(null);

  const openPlayerCard = useCallback((id: number) => setPlayerId(id), []);
  const closePlayerCard = useCallback(() => setPlayerId(null), []);

  return (
    <PlayerCardContext.Provider value={{ openPlayerCard }}>
      {children}
      {/* Keyed by player so opening another one starts from clean state
          rather than flashing the previous player's numbers. */}
      {playerId !== null && (
        <PlayerCard key={playerId} playerId={playerId} onClose={closePlayerCard} />
      )}
    </PlayerCardContext.Provider>
  );
}
