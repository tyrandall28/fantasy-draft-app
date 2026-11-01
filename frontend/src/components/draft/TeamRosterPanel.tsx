import { usePlayerCard } from "../../context/playerCard";
import type { DraftState } from "../../types";
import { positionText } from "../../lib/positionColors";


interface Props {
  state: DraftState;
  userId?: string;
}

export default function TeamRosterPanel({ state, userId }: Props) {
  const { openPlayerCard } = usePlayerCard();
  // Find which draft_order index is ours (first occurrence only)
  const myDraftIndex = state.draft_order.indexOf(userId ?? "");

  // Use the same snake logic as the board to determine which column an overall pick belongs to
  const myPicks = state.picks.filter((p) => {
    const roundNum = Math.floor((p.overall_pick - 1) / state.team_count) + 1;
    let colIndex = (p.overall_pick - 1) % state.team_count;
    if (roundNum % 2 === 0) {
      colIndex = state.team_count - 1 - colIndex;
    }
    return colIndex === myDraftIndex;
  });

  return (
    <div className="bg-ink-800 flex flex-col h-full">
      <div className="p-3 border-b border-ink-700">
        <h3 className="font-semibold text-chalk-dim text-base">
          My Roster ({myPicks.length})
        </h3>
      </div>
      <div className="flex-1 overflow-y-auto">
        {myPicks.length === 0 ? (
          <p className="p-4 text-sm text-chalk-mut text-center">No picks yet</p>
        ) : (
          myPicks.map((pick) => (
            <div
              key={pick.overall_pick}
              className="flex items-center gap-2 px-3 py-2.5 border-b border-ink-700"
            >
              <span className="text-xs text-chalk-mut w-6 font-mono">
                R{pick.round_num}
              </span>
              <span className={`text-xs font-bold ${positionText(pick.player.position)}`}>
                {pick.player.position}
              </span>
              <span
                className="text-sm text-chalk-dim truncate cursor-pointer hover:text-accent transition-colors"
                onClick={() => openPlayerCard(pick.player.id)}
              >{pick.player.full_name}</span>
              <span className="text-xs text-chalk-mut ml-auto flex-shrink-0">{pick.player.nfl_team}</span>
              {pick.is_auto && (
                <span className="text-xs bg-caution/20 text-caution px-1.5 rounded flex-shrink-0">Auto</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
