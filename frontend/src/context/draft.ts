import { createContext, useContext } from "react";
import type { DraftPick, DraftState } from "../types";

export interface DraftContextType {
  leagueId: string;
  state: DraftState | null;
  connected: boolean;
  makePick: (playerId: number) => void;
  toggleTimer: (enabled: boolean) => void;
  undoPick: () => void;
  myPicks: DraftPick[];
  draftedPlayerIds: Set<number>;
}

export const DraftContext = createContext<DraftContextType | null>(null);

export function useDraft() {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft must be used within DraftProvider");
  return ctx;
}

/**
 * What the server sends down the draft socket, mirroring `backend/app/ws/`.
 * `user_joined`, `user_left` and `error` are sent but not yet handled here.
 */
export type DraftServerEvent =
  | ({ event: "draft_state" } & Omit<DraftState, "timer_enabled" | "bot_ids"> & {
        timer_enabled?: boolean;
        bot_ids?: string[];
      })
  | ({ event: "pick_made" } & DraftPick)
  | { event: "turn_start"; user_id: string; seconds_remaining: number; overall_pick: number }
  | { event: "timer_tick"; seconds_remaining: number }
  | { event: "settings_updated"; timer_enabled: boolean }
  | { event: "draft_complete" }
  | { event: "user_joined" | "user_left" }
  | { event: "error"; message: string };
