import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { UserRankingEntry } from "../../types";

const POS_COLORS: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-emerald-500/20 text-emerald-400",
  WR: "bg-sky-500/20 text-sky-400",
  TE: "bg-amber-500/20 text-amber-400",
  K: "bg-purple-500/20 text-purple-400",
  DST: "bg-slate-500/20 text-slate-400",
};

interface Props {
  entry: UserRankingEntry;
  displayRank: number;
  onToggleLock: (entryId: number, locked: boolean) => void;
  diff: number | null;
}

export default function RankingRow({ entry, displayRank, onToggleLock, diff }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id, disabled: entry.is_locked });

  const posColor = POS_COLORS[entry.player.position] ?? "bg-slate-500/20 text-slate-400";

  const hasDiff = diff !== null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: "grid",
        gap: "0.5rem",
        gridTemplateColumns: hasDiff ? "1fr 4fr 2fr 2fr 1fr 1fr 2fr" : "1fr 4fr 2fr 2fr 1fr 2fr",
      }}
      className={`px-4 py-2 border-b border-white/5 items-center text-sm min-h-[40px] ${
        isDragging ? "opacity-50 bg-sky-500/10" : "hover:bg-white/[0.03]"
      } ${entry.is_locked ? "bg-amber-500/5" : ""}`}
      {...attributes}
      {...listeners}
    >
      <div className="text-slate-500 font-mono text-xs">
        {displayRank}
      </div>
      <div className="font-medium text-slate-200 truncate min-w-0">
        {entry.player.full_name}
      </div>
      <div>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded ${posColor}`}>
          {entry.player.position}
        </span>
      </div>
      <div className="text-slate-500 text-xs">
        {entry.player.nfl_team}
      </div>
      <div className="text-slate-600 text-xs">
        {entry.player.bye_week}
      </div>
      {hasDiff && (
        <div className="text-center">
          <span
            className={`text-xs font-mono font-bold ${
              diff > 0 ? "text-emerald-400" : diff < 0 ? "text-red-400" : "text-slate-600"
            }`}
            title={`${Math.abs(diff)} spots ${diff > 0 ? "higher" : diff < 0 ? "lower" : "same"} than source`}
          >
            {diff > 0 ? `+${diff}` : diff === 0 ? "=" : `${diff}`}
          </span>
        </div>
      )}
      <div className="text-center">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleLock(entry.id, !entry.is_locked);
          }}
          className={`text-xs px-2 py-1 rounded ${
            entry.is_locked
              ? "bg-amber-500/20 text-amber-400"
              : "bg-white/5 text-slate-600 hover:text-slate-400"
          }`}
        >
          {entry.is_locked ? "Locked" : "Lock"}
        </button>
      </div>
    </div>
  );
}
