import { createContext, useContext } from "react";

export interface PlayerCardContextType {
  openPlayerCard: (playerId: number) => void;
}

export const PlayerCardContext = createContext<PlayerCardContextType | null>(null);

export function usePlayerCard() {
  const ctx = useContext(PlayerCardContext);
  if (!ctx) throw new Error("usePlayerCard must be used within PlayerCardProvider");
  return ctx;
}
