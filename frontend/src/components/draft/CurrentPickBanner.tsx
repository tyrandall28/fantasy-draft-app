import type { DraftState } from "../../types";

interface Props {
  state: DraftState;
  isMyTurn: boolean;
}

export default function CurrentPickBanner({ state, isMyTurn }: Props) {
  const currentPicker = state.picks.length > 0
    ? state.picks.find((p) => p.user_id === state.current_user_id)?.username
    : undefined;

  const roundNum = Math.floor((state.current_pick - 1) / state.team_count) + 1;
  const pickInRound = ((state.current_pick - 1) % state.team_count) + 1;

  return (
    <div className={`px-4 py-1.5 rounded-lg ${isMyTurn ? "bg-rise/15 border border-rise/30" : "bg-ink-700"}`}>
      <p className="text-sm font-medium text-chalk-dim">
        Round {roundNum}, Pick {pickInRound} (#{state.current_pick} overall)
      </p>
      <p className={`text-xs ${isMyTurn ? "text-rise font-bold" : "text-chalk-mut"}`}>
        {isMyTurn ? "Your pick!" : `Waiting for ${currentPicker ?? "..."}`}
      </p>
    </div>
  );
}
