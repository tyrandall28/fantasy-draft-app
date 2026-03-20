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
    <div className={`px-4 py-1.5 rounded-lg ${isMyTurn ? "bg-green-500/15 border border-green-500/30" : "bg-white/5"}`}>
      <p className="text-sm font-medium text-slate-200">
        Round {roundNum}, Pick {pickInRound} (#{state.current_pick} overall)
      </p>
      <p className={`text-xs ${isMyTurn ? "text-green-400 font-bold" : "text-slate-500"}`}>
        {isMyTurn ? "Your pick!" : `Waiting for ${currentPicker ?? "..."}`}
      </p>
    </div>
  );
}
