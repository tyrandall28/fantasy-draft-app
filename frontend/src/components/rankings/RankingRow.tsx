import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { usePlayerCard } from "../../context/playerCard";
import type { UserRankingEntry } from "../../types";
import { positionBadge } from "../../lib/positionColors";


interface Props {
  entry: UserRankingEntry;
  displayRank: number;
  onToggleLock: (entryId: number, locked: boolean) => void;
  diff: number | null;
  isSelected?: boolean;
  onSelect?: (playerId: number) => void;
}

export default function RankingRow({ entry, displayRank, onToggleLock, diff, isSelected, onSelect }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id, disabled: entry.is_locked });
  const { openPlayerCard } = usePlayerCard();

  const posColor = positionBadge(entry.player.position);

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
      onClick={() => onSelect?.(entry.player.id)}
      className={`px-4 py-2 border-b border-ink-700 items-center text-sm min-h-[40px] cursor-pointer ${
        isDragging ? "opacity-50 bg-accent/10" : "hover:bg-ink-700"
      } ${entry.is_locked ? "bg-caution/5" : ""} ${
        isSelected ? "!bg-accent/[0.08] border-l-2 border-l-accent" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      <div className="text-chalk-mut font-mono text-xs">
        {displayRank}
      </div>
      <div className="min-w-0 truncate">
        <span
          className="font-medium text-chalk-dim cursor-pointer hover:text-accent transition-colors"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            openPlayerCard(entry.player.id);
          }}
        >
          {entry.player.full_name}
        </span>
      </div>
      <div>
        <span className={`badge ${posColor}`}>
          {entry.player.position}
        </span>
      </div>
      <div className="text-chalk-mut text-xs">
        {entry.player.nfl_team}
      </div>
      <div className="text-chalk-mut text-xs">
        {entry.player.bye_week}
      </div>
      {hasDiff && (
        <div className="text-center">
          <span
            className={`text-xs font-mono font-bold ${
              diff > 0 ? "text-rise" : diff < 0 ? "text-fall" : "text-chalk-mut"
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
              ? "bg-caution/20 text-caution"
              : "bg-ink-700 text-chalk-mut hover:text-chalk-dim"
          }`}
        >
          {entry.is_locked ? "Locked" : "Lock"}
        </button>
      </div>
    </div>
  );
}
