import type { DraftState } from "../../types";

// Sleeper-style bold position colors — left border accent + cell background
const POS_CELL: Record<string, { bg: string; border: string; text: string }> = {
  QB:  { bg: "bg-red-500/20",    border: "border-l-red-500",    text: "text-red-400" },
  RB:  { bg: "bg-emerald-500/20", border: "border-l-emerald-500", text: "text-emerald-400" },
  WR:  { bg: "bg-sky-500/20",    border: "border-l-sky-500",    text: "text-sky-400" },
  TE:  { bg: "bg-amber-500/20",  border: "border-l-amber-500",  text: "text-amber-400" },
  K:   { bg: "bg-purple-500/20", border: "border-l-purple-500", text: "text-purple-400" },
  DST: { bg: "bg-slate-500/20",  border: "border-l-slate-500",  text: "text-slate-400" },
};

const DEFAULT_CELL = { bg: "bg-slate-500/10", border: "border-l-slate-600", text: "text-slate-400" };

interface Props {
  state: DraftState;
  userId?: string;
}

export default function DraftBoard({ state, userId }: Props) {
  const { picks, team_count, roster_size, draft_order } = state;
  const rounds = roster_size;
  const pickMap = new Map(picks.map((p) => [p.overall_pick, p]));

  // Equal column widths: round label gets fixed width, rest split evenly
  const colWidth = `${100 / draft_order.length}%`;

  return (
    <div className="bg-[#1a1d26] rounded-xl overflow-hidden h-full flex flex-col">
      <div className="overflow-auto flex-1">
        <table className="w-full border-collapse text-sm table-fixed" style={{ minWidth: `${Math.max(draft_order.length * 120, 600)}px` }}>
          <colgroup>
            <col style={{ width: "40px" }} />
            {draft_order.map((_, i) => (
              <col key={i} style={{ width: colWidth }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#12141b]">
              <th className="py-2.5 px-2 text-slate-500 font-medium text-center sticky left-0 bg-[#12141b] z-20">
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
                      isMe ? "text-sky-400" : isBot ? "text-amber-400" : "text-slate-300"
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
                <tr key={roundNum} className={roundNum % 2 === 0 ? "bg-[#1e2130]" : "bg-[#1a1d26]"}>
                  <td className="py-0 px-2 text-slate-500 text-center font-mono font-medium sticky left-0 z-10" style={{ backgroundColor: roundNum % 2 === 0 ? "#1e2130" : "#1a1d26" }}>
                    {roundNum}
                  </td>
                  {draft_order.map((uid, colIdx) => {
                    const pickIdx = isEven ? team_count - 1 - colIdx : colIdx;
                    const overall = roundIdx * team_count + pickIdx + 1;
                    const pick = pickMap.get(overall);
                    const isCurrent = overall === state.current_pick;
                    const isMyCol = uid === userId;

                    const pos = pick ? (POS_CELL[pick.player.position] ?? DEFAULT_CELL) : null;

                    return (
                      <td key={colIdx} className="p-[2px]">
                        <div
                          className={`
                            rounded-md h-[64px] flex flex-col items-start justify-center px-2.5 border-l-[3px] transition-all
                            ${pick
                              ? `${pos!.bg} ${pos!.border}`
                              : isCurrent
                              ? "border-l-green-400 bg-green-500/15 ring-1 ring-green-500/30"
                              : isMyCol
                              ? "border-l-sky-900/50 bg-sky-500/5"
                              : "border-l-transparent bg-white/[0.03]"
                            }
                          `}
                        >
                          {pick ? (
                            <>
                              <span className="text-white font-semibold text-sm leading-tight truncate w-full">
                                {pick.player.full_name}
                              </span>
                              <span className={`text-xs leading-tight font-medium mt-0.5 ${pos!.text}`}>
                                {pick.player.position} - {pick.player.nfl_team}
                              </span>
                            </>
                          ) : (
                            <span className={`text-xs font-mono ${isCurrent ? "text-green-400 font-bold" : "text-slate-600"}`}>
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
