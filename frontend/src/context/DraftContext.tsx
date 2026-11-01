import { useCallback, useMemo, useState, type ReactNode } from "react";
import { getValidAccessToken } from "../api/client";
import { useWebSocket } from "../hooks/useWebSocket";
import type { DraftState } from "../types";
import { DraftContext, type DraftServerEvent } from "./draft";

interface Props {
  leagueId: string;
  children: ReactNode;
}

export function DraftProvider({ leagueId, children }: Props) {
  const [state, setState] = useState<DraftState | null>(null);

  const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${wsProtocol}//${window.location.host}/ws/draft/${leagueId}`;

  const getToken = useCallback(() => getValidAccessToken(), []);

  const handleMessage = useCallback((message: unknown) => {
    const data = message as DraftServerEvent;
    switch (data.event) {
      case "draft_state":
        setState({
          picks: data.picks,
          current_pick: data.current_pick,
          current_user_id: data.current_user_id,
          commissioner_id: data.commissioner_id,
          seconds_remaining: data.seconds_remaining,
          status: data.status,
          draft_order: data.draft_order,
          team_count: data.team_count,
          roster_size: data.roster_size,
          timer_enabled: data.timer_enabled ?? true,
          bot_ids: data.bot_ids ?? [],
        });
        break;

      case "pick_made":
        setState((prev) => {
          if (!prev) return prev;
          const newPicks = [...prev.picks, data];
          const nextPick = prev.current_pick + 1;
          return { ...prev, picks: newPicks, current_pick: nextPick };
        });
        break;

      case "turn_start":
        setState((prev) =>
          prev
            ? {
                ...prev,
                current_user_id: data.user_id,
                seconds_remaining: data.seconds_remaining,
                current_pick: data.overall_pick,
              }
            : prev
        );
        break;

      case "timer_tick":
        setState((prev) =>
          prev ? { ...prev, seconds_remaining: data.seconds_remaining } : prev
        );
        break;

      case "settings_updated":
        setState((prev) =>
          prev
            ? {
                ...prev,
                timer_enabled: data.timer_enabled,
                seconds_remaining: data.timer_enabled ? prev.seconds_remaining : 0,
              }
            : prev
        );
        break;

      case "draft_complete":
        setState((prev) => (prev ? { ...prev, status: "completed" } : prev));
        break;
    }
  }, []);

  const { connected, send } = useWebSocket({
    url: wsUrl,
    onMessage: handleMessage,
    getToken,
  });

  const makePick = useCallback(
    (playerId: number) => {
      send({ event: "make_pick", player_id: playerId });
    },
    [send]
  );

  const toggleTimer = useCallback(
    (enabled: boolean) => {
      send({ event: "toggle_timer", enabled });
    },
    [send]
  );

  const undoPick = useCallback(() => {
    send({ event: "undo_pick" });
  }, [send]);

  const draftedPlayerIds = useMemo(
    () => new Set(state?.picks.map((p) => p.player_id) ?? []),
    [state?.picks]
  );

  const myPicks = useMemo(() => {
    const userId = localStorage.getItem("user_id");
    return state?.picks.filter((p) => p.user_id === userId) ?? [];
  }, [state?.picks]);

  return (
    <DraftContext.Provider
      value={{ leagueId, state, connected, makePick, toggleTimer, undoPick, myPicks, draftedPlayerIds }}
    >
      {children}
    </DraftContext.Provider>
  );
}
