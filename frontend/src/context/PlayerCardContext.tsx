import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import PlayerCard from "../components/PlayerCard";

interface PlayerCardContextType {
  openPlayerCard: (playerId: number) => void;
}

const PlayerCardContext = createContext<PlayerCardContextType | null>(null);

export function PlayerCardProvider({ children }: { children: ReactNode }) {
  const [playerId, setPlayerId] = useState<number | null>(null);

  const openPlayerCard = useCallback((id: number) => setPlayerId(id), []);
  const closePlayerCard = useCallback(() => setPlayerId(null), []);

  return (
    <PlayerCardContext.Provider value={{ openPlayerCard }}>
      {children}
      <PlayerCard playerId={playerId} onClose={closePlayerCard} />
    </PlayerCardContext.Provider>
  );
}

export function usePlayerCard() {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) throw new Error("usePlayerCard must be used within PlayerCardProvider");
  return ctx;
}
