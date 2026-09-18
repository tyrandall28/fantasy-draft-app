import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useMemo, useState } from "react";
import type { BaseRankingEntry, UserRankingDetail } from "../../types";
import RankingRow from "./RankingRow";

interface Props {
  ranking: UserRankingDetail;
  onReorder: (entryIds: number[]) => Promise<void>;
  onToggleLock: (entryId: number, locked: boolean) => Promise<void>;
  comparisonBaseEntries?: BaseRankingEntry[];
  selectedPlayerIds?: number[];
  onPlayerSelect?: (playerId: number) => void;
}

export default function RankingList({ ranking, onReorder, onToggleLock, comparisonBaseEntries, selectedPlayerIds, onPlayerSelect }: Props) {
  const [filter, setFilter] = useState("");
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const entries = ranking.entries;
  const filteredEntries = filter
    ? entries.filter(
        (e) =>
          e.player.full_name.toLowerCase().includes(filter.toLowerCase()) ||
          e.player.position.toLowerCase().includes(filter.toLowerCase()) ||
          e.player.nfl_team.toLowerCase().includes(filter.toLowerCase())
      )
    : entries;

  // Build lookup: player_id -> source rank for diff display
  const sourceRankMap = useMemo(() => {
    if (!comparisonBaseEntries?.length) return null;
    return new Map(comparisonBaseEntries.map((e) => [e.player_id, e.rank]));
  }, [comparisonBaseEntries]);

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = entries.findIndex((e) => e.id === active.id);
    const newIndex = entries.findIndex((e) => e.id === over.id);

    if (entries[oldIndex].is_locked) return;

    const newOrder = [...entries];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);

    await onReorder(newOrder.map((e) => e.id));
  };

  const hasComparison = sourceRankMap !== null;

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-ink-700 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-bold text-chalk">{ranking.name}</h2>
          <p className="text-xs text-chalk-mut">
            {entries.length} players &middot; {ranking.source}
          </p>
        </div>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter players..."
          className="panel px-3 py-1.5 text-sm w-48 text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50"
        />
      </div>

      {/* Header row */}
      <div className={`grid gap-2 px-4 py-2 text-xs font-semibold text-chalk-mut border-b border-ink-700 flex-shrink-0 ${hasComparison ? "grid-cols-13" : "grid-cols-12"}`} style={hasComparison ? { gridTemplateColumns: "1fr 4fr 2fr 2fr 1fr 1fr 2fr" } : { gridTemplateColumns: "1fr 4fr 2fr 2fr 1fr 2fr" }}>
        <div>Rank</div>
        <div>Player</div>
        <div>Position</div>
        <div>Team</div>
        <div>Bye</div>
        {hasComparison && <div className="text-center">Diff</div>}
        <div className="text-center">Lock</div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={filteredEntries.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="flex-1 overflow-y-auto">
            {filteredEntries.map((entry, idx) => {
              const displayRank = filter ? entry.rank : idx + 1;
              const sourceRank = sourceRankMap?.get(entry.player_id);
              const diff = sourceRank !== undefined ? sourceRank - displayRank : null;

              return (
                <RankingRow
                  key={entry.id}
                  entry={entry}
                  displayRank={displayRank}
                  onToggleLock={onToggleLock}
                  diff={diff}
                  isSelected={selectedPlayerIds?.includes(entry.player.id) ?? false}
                  onSelect={onPlayerSelect}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
