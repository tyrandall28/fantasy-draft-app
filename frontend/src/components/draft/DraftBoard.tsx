import { usePlayerCard } from "../../context/PlayerCardContext";
import type { DraftState } from "../../types";
import { POSITION_CELL, POSITION_CELL_DEFAULT } from "../../lib/positionColors";


interface Props {
  state: DraftState;
  userId?: string;
}

export default function DraftBoard({ state, userId }: Props) {
  const { openPlayerCard } = usePlayerCard();
  const { picks, team_count, roster_size, draft_order } = state;
  const rounds = roster_size;
  const pickMap = new Map(picks.map((p) => [p.overall_pick, p]));

  // Equal column widths: round label gets fixed width, rest split evenly
  const colWidth = `${100 / draft_order.length}%`;

  return (
    <div className="bg-ink-700 rounded-xl overflow-hidden h-full flex flex-col">
      <div className="overflow-auto flex-1">
        <table className="w-full border-collapse text-sm table-fixed" style={{ minWidth: `${Math.max(draft_order.length * 120, 600)}px` }}>
          <colgroup>
            <col style={{ width: "40px" }} />
            {draft_order.map((_, i) => (
              <col key={i} style={{ width: colWidth }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-ink-800">
              <th className="py-2.5 px-2 text-chalk-mut font-medium text-center sticky left-0 bg-ink-800 z-20">
                RD
              </th>
              {draft_order.map((uid, i) => {
                const pick = picks.find((p) => p.user_id === uid);
                const isMe = uid === userId;
                const isBot = state.bot_ids?.includes(uid);
                return (
                  <th
                    key={`${uid}-${i}`}
                    className={`py-2.5 px-1 font-semibold text-center ${
                      isMe ? "text-accent" : isBot ? "text-caution" : "text-chalk-dim"
                    }`}
                  >
                    <div className="truncate">
                      {pick?.username || `Team ${i + 1}`}
                      {isBot && <span className="text-[9px] ml-1 opacity-60">CPU</span>}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rounds }, (_, roundIdx) => {
              const roundNum = roundIdx + 1;
              const isEven = roundNum % 2 === 0;

              return (
                <tr key={roundNum} className={roundNum % 2 === 0 ? "bg-ink-700" : "bg-ink-700"}>
                  <td className="py-0 px-2 text-chalk-mut text-center font-mono font-medium sticky left-0 z-10" style={{ backgroundColor: roundNum % 2 === 0 ? "#232320" : "#232320" }}>
                    {roundNum}
                  </td>
                  {draft_order.map((uid, colIdx) => {
                    const pickIdx = isEven ? team_count - 1 - colIdx : colIdx;
                    const overall = roundIdx * team_count + pickIdx + 1;
                    const pick = pickMap.get(overall);
                    const isCurrent = overall === state.current_pick;
                    const isMyCol = uid === userId;

                    const pos = pick ? (POSITION_CELL[pick.player.position] ?? POSITION_CELL_DEFAULT) : null;

                    return (
                      <td key={colIdx} className="p-[2px]">
                        <div
                          className={`
                            rounded-md h-[64px] flex flex-col items-start justify-center px-2.5 border-l-[3px] transition-all
                            ${pick
                              ? `${pos!.bg} ${pos!.border}`
                              : isCurrent
                              ? "border-l-rise bg-rise/15 ring-1 ring-rise/30"
                              : isMyCol
                              ? "border-l-accent/40 bg-accent/5"
                              : "border-l-transparent bg-ink-700"
                            }
                          `}
                        >
                          {pick ? (
                            <>
                              <span
                                className="text-chalk font-semibold text-sm leading-tight truncate w-full cursor-pointer hover:text-accent transition-colors"
                                onClick={() => openPlayerCard(pick.player.id)}
                              >
                                {pick.player.full_name}
                              </span>
                              <span className={`text-xs leading-tight font-medium mt-0.5 ${pos!.text}`}>
                                {pick.player.position} - {pick.player.nfl_team}
                              </span>
                            </>
                          ) : (
                            <span className={`text-xs font-mono ${isCurrent ? "text-rise font-bold" : "text-chalk-mut"}`}>
                              {overall}
                            </span>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
