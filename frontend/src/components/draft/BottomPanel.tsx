import { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch } from "../../api/client";
import type { DraftPick, UserRanking, UserRankingDetail, UserRankingEntry } from "../../types";
import DraftValuePanel from "./DraftValuePanel";
import { positionBadge } from "../../lib/positionColors";


type Tab = "history" | "rankings" | "analysis";

interface Props {
  picks: DraftPick[];
}

const MIN_HEIGHT = 120;
const COLLAPSED_HEIGHT = 36;
const MAX_HEIGHT_RATIO = 0.95; // max 95% of viewport

export default function BottomPanel({ picks }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("history");
  const [height, setHeight] = useState(280);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const savedHeight = useRef(280);
  const isDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(0);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    startY.current = e.clientY;
    startHeight.current = height;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }, [height]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      const delta = startY.current - e.clientY;
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;
      const newHeight = Math.min(Math.max(startHeight.current + delta, MIN_HEIGHT), maxHeight);
      setHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const tabs: { key: Tab; label: string }[] = [
    { key: "history", label: "Draft History" },
    { key: "rankings", label: "My Rankings" },
    { key: "analysis", label: "Analysis" },
  ];

  const toggleCollapse = () => {
    if (collapsed) {
      setHeight(savedHeight.current);
      setCollapsed(false);
    } else {
      savedHeight.current = height;
      setExpanded(false);
      setCollapsed(true);
    }
  };

  const toggleExpand = () => {
    if (expanded) {
      setHeight(savedHeight.current);
      setExpanded(false);
    } else {
      if (!collapsed) savedHeight.current = height;
      setCollapsed(false);
      setExpanded(true);
    }
  };

  const resolvedHeight = collapsed
    ? COLLAPSED_HEIGHT
    : expanded
    ? window.innerHeight * MAX_HEIGHT_RATIO
    : height;

  return (
    <div
      className="bg-ink-800 border-t border-ink-700 flex flex-col flex-shrink-0 transition-[height] duration-200"
      style={{ height: `${resolvedHeight}px` }}
    >
      {/* Full-width drag handle pinned to the top edge of the panel.
          Hidden when collapsed or fully expanded — nothing to resize. */}
      {!collapsed && !expanded && (
        <div
          onMouseDown={handleMouseDown}
          className="h-2 w-full cursor-row-resize group flex items-center justify-center hover:brightness-110/10 transition-colors flex-shrink-0 border-b border-ink-700"
          title="Drag up or down to resize"
        >
          <div className="w-12 h-1 rounded-full bg-ink-600 group-hover:brightness-110 transition-colors" />
        </div>
      )}

      {/* Top bar: collapse/expand toggles + tabs */}
      <div className="flex items-center flex-shrink-0 border-b border-ink-700">
        {/* Collapse toggle */}
        <button
          onClick={toggleCollapse}
          className="flex items-center gap-1 px-2 py-1.5 text-chalk-mut hover:text-chalk-dim transition-colors flex-shrink-0"
          title={collapsed ? "Open panel" : "Collapse panel"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>

        {/* Expand/shrink toggle */}
        <button
          onClick={toggleExpand}
          className="flex items-center gap-1 px-2 py-1.5 text-chalk-mut hover:text-chalk-dim transition-colors flex-shrink-0"
          title={expanded ? "Restore panel size" : "Expand to full screen"}
        >
          {expanded ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5 10a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1z" clipRule="evenodd" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 4a1 1 0 011-1h4a1 1 0 010 2H6.414l2.293 2.293a1 1 0 11-1.414 1.414L5 6.414V8a1 1 0 01-2 0V4zm9 1a1 1 0 110-2h4a1 1 0 011 1v4a1 1 0 11-2 0V6.414l-2.293 2.293a1 1 0 11-1.414-1.414L13.586 5H12zm-9 7a1 1 0 112 0v1.586l2.293-2.293a1 1 0 111.414 1.414L6.414 15H8a1 1 0 110 2H4a1 1 0 01-1-1v-4zm13 0a1 1 0 10-2 0v1.586l-2.293-2.293a1 1 0 10-1.414 1.414L13.586 15H12a1 1 0 100 2h4a1 1 0 001-1v-4z" clipRule="evenodd" />
            </svg>
          )}
        </button>

        {/* Tab bar */}
        <div className="flex px-2">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                if (collapsed) {
                  setCollapsed(false);
                  setHeight(savedHeight.current);
                }
              }}
              className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                activeTab === tab.key
                  ? "border-accent text-accent"
                  : "border-transparent text-chalk-mut hover:text-chalk-dim"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content (hidden when collapsed) */}
      {!collapsed && (
        <div className="flex-1 overflow-hidden">
          {activeTab === "history" && <DraftHistoryTab picks={picks} />}
          {activeTab === "rankings" && <RankingsTab />}
          {activeTab === "analysis" && <AnalysisTab />}
        </div>
      )}
    </div>
  );
}

/* ── Draft History Tab ─────────────────────────────────────────── */

function DraftHistoryTab({ picks }: { picks: DraftPick[] }) {
  const sortedPicks = [...picks].sort((a, b) => b.overall_pick - a.overall_pick);

  return (
    <div className="h-full overflow-y-auto">
      {sortedPicks.length === 0 ? (
        <p className="text-sm text-chalk-mut text-center py-8">No picks yet</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-ink-800 z-10">
            <tr className="text-chalk-mut">
              <th className="text-left py-1.5 px-4 font-medium">Pick</th>
              <th className="text-left py-1.5 px-2 font-medium">Round</th>
              <th className="text-left py-1.5 px-2 font-medium">Team</th>
              <th className="text-left py-1.5 px-2 font-medium">Player</th>
              <th className="text-left py-1.5 px-2 font-medium">Pos</th>
              <th className="text-left py-1.5 px-2 font-medium">NFL Team</th>
              <th className="text-left py-1.5 px-2 font-medium">Type</th>
            </tr>
          </thead>
          <tbody>
            {sortedPicks.map((pick) => (
              <tr key={pick.overall_pick} className="border-t border-ink-700 hover:bg-ink-700/60">
                <td className="py-1.5 px-4 text-chalk-dim font-mono">#{pick.overall_pick}</td>
                <td className="py-1.5 px-2 text-chalk-mut">R{pick.round_num}</td>
                <td className="py-1.5 px-2 text-chalk-dim">{pick.username}</td>
                <td className="py-1.5 px-2 text-chalk-dim font-medium">{pick.player.full_name}</td>
                <td className="py-1.5 px-2">
                  <span className={`badge ${positionBadge(pick.player.position)}`}>
                    {pick.player.position}
                  </span>
                </td>
                <td className="py-1.5 px-2 text-chalk-mut">{pick.player.nfl_team}</td>
                <td className="py-1.5 px-2">
                  {pick.is_auto ? (
                    <span className="text-xs bg-caution/20 text-caution px-1.5 py-0.5 rounded">Auto</span>
                  ) : (
                    <span className="text-xs text-chalk-mut">Manual</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ── Rankings Tab ───────────────────────────────────────────────── */

function DarkRankingRow({ entry, displayRank, onToggleLock }: {
  entry: UserRankingEntry;
  displayRank: number;
  onToggleLock: (entryId: number, locked: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: entry.id, disabled: entry.is_locked });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 border-b border-ink-700 text-sm ${
        isDragging ? "opacity-50 bg-accent/10" : "hover:bg-ink-700"
      } ${entry.is_locked ? "bg-caution/5" : ""}`}
      {...attributes}
      {...listeners}
    >
      <span className="text-chalk-mut font-mono w-6 text-right flex-shrink-0">{displayRank}</span>
      <span className={`badge flex-shrink-0 ${positionBadge(entry.player.position)}`}>
        {entry.player.position}
      </span>
      <span className="text-chalk-dim font-medium truncate flex-1">{entry.player.full_name}</span>
      <span className="text-chalk-mut flex-shrink-0 w-10">{entry.player.nfl_team}</span>
      <span className="text-chalk-mut flex-shrink-0 w-8">Bye {entry.player.bye_week}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          // TODO: AI-powered health check
        }}
        className="text-xs px-2 py-0.5 rounded flex-shrink-0 bg-rise/10 text-rise hover:bg-rise/20 hover:text-rise transition-colors cursor-not-allowed"
        title="Coming soon — AI injury & status check"
      >
        Health
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          // TODO: AI-powered news search
        }}
        className="text-xs px-2 py-0.5 rounded flex-shrink-0 bg-accent/10 text-accent hover:brightness-110/20 hover:text-accent transition-colors cursor-not-allowed"
        title="Coming soon — AI news & tweet search"
      >
        News
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleLock(entry.id, !entry.is_locked);
        }}
        className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ${
          entry.is_locked
            ? "bg-caution/20 text-caution"
            : "bg-ink-700 text-chalk-mut hover:text-chalk-dim"
        }`}
      >
        {entry.is_locked ? "Locked" : "Lock"}
      </button>
    </div>
  );
}

function RankingsTab() {
  const [sources, setSources] = useState<{ value: string; label: string }[]>([]);
  const [selectedSource, setSelectedSource] = useState("");
  const [rankings, setRankings] = useState<UserRanking[]>([]);
  const [activeRanking, setActiveRanking] = useState<UserRankingDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [filter, setFilter] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    apiFetch<UserRanking[]>("/api/rankings").then(setRankings);
    apiFetch<{ value: string; label: string }[]>("/api/rankings/sources").then((s) => {
      setSources(s);
      if (s.length > 0) setSelectedSource((current) => current || s[0].value);
    });
  }, []);

  const loadRanking = async (id: string) => {
    const data = await apiFetch<UserRankingDetail>(`/api/rankings/${id}`);
    setActiveRanking(data);
  };

  const createRanking = async () => {
    if (!newName.trim() || !selectedSource) return;
    setCreating(true);
    try {
      const data = await apiFetch<UserRanking>("/api/rankings", {
        method: "POST",
        body: JSON.stringify({ source: selectedSource, name: newName.trim() }),
      });
      const updated = await apiFetch<UserRanking[]>("/api/rankings");
      setRankings(updated);
      await loadRanking(data.id);
      setNewName("");
    } finally {
      setCreating(false);
    }
  };

  const handleReorder = async (entryIds: number[]) => {
    if (!activeRanking) return;
    await apiFetch(`/api/rankings/${activeRanking.id}/reorder`, {
      method: "PUT",
      body: JSON.stringify({ entry_ids: entryIds }),
    });
    await loadRanking(activeRanking.id);
  };

  const handleToggleLock = async (entryId: number, locked: boolean) => {
    if (!activeRanking) return;
    await apiFetch(`/api/rankings/${activeRanking.id}/entries/${entryId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_locked: locked }),
    });
    await loadRanking(activeRanking.id);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeRanking) return;

    const entries = activeRanking.entries;
    const oldIndex = entries.findIndex((e) => e.id === active.id);
    const newIndex = entries.findIndex((e) => e.id === over.id);
    if (entries[oldIndex].is_locked) return;

    const newOrder = [...entries];
    const [moved] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, moved);
    await handleReorder(newOrder.map((e) => e.id));
  };

  const filteredEntries = activeRanking?.entries.filter(
    (e) =>
      !filter ||
      e.player.full_name.toLowerCase().includes(filter.toLowerCase()) ||
      e.player.position.toLowerCase().includes(filter.toLowerCase()) ||
      e.player.nfl_team.toLowerCase().includes(filter.toLowerCase())
  ) ?? [];

  return (
    <div className="h-full flex">
      {/* Sidebar: list + create */}
      <div className="w-56 flex-shrink-0 border-r border-ink-700 flex flex-col overflow-hidden">
        <div className="p-2 border-b border-ink-700 space-y-1.5">
          <select
            value={selectedSource}
            onChange={(e) => setSelectedSource(e.target.value)}
            className="w-full bg-ink-700 border border-ink-600 rounded px-2 py-1 text-xs text-chalk-dim focus:outline-none focus:border-accent"
          >
            {sources.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <div className="flex gap-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ranking name..."
              className="flex-1 bg-ink-700 border border-ink-600 rounded px-2 py-1 text-xs text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:border-accent"
              onKeyDown={(e) => e.key === "Enter" && createRanking()}
            />
            <button
              onClick={createRanking}
              disabled={creating || !newName.trim() || !selectedSource}
              className="btn-primary text-xs px-2 py-1 disabled:opacity-30 flex-shrink-0"
            >
              {creating ? "..." : "Create"}
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {rankings.map((r) => (
            <button
              key={r.id}
              onClick={() => loadRanking(r.id)}
              className={`w-full text-left px-3 py-2 text-sm border-b border-ink-700 transition-colors ${
                activeRanking?.id === r.id
                  ? "bg-accent/10 text-accent"
                  : "text-chalk-dim hover:bg-ink-700"
              }`}
            >
              <p className="font-medium truncate">{r.name}</p>
              <p className="text-xs text-chalk-mut">{r.source}</p>
            </button>
          ))}
          {rankings.length === 0 && (
            <p className="text-xs text-chalk-mut text-center py-4">No rankings yet</p>
          )}
        </div>
      </div>

      {/* Ranking editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeRanking ? (
          <>
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink-700 flex-shrink-0">
              <div>
                <span className="text-sm font-medium text-chalk-dim">{activeRanking.name}</span>
                <span className="text-xs text-chalk-mut ml-2">{activeRanking.entries.length} players</span>
              </div>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter..."
                className="bg-ink-700 border border-ink-600 rounded px-2 py-0.5 text-xs text-chalk-dim placeholder:text-chalk-mut focus:outline-none focus:border-accent w-40"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={filteredEntries.map((e) => e.id)} strategy={verticalListSortingStrategy}>
                  {filteredEntries.map((entry, idx) => (
                    <DarkRankingRow
                      key={entry.id}
                      entry={entry}
                      displayRank={filter ? entry.rank : idx + 1}
                      onToggleLock={handleToggleLock}
                    />
                  ))}
                </SortableContext>
              </DndContext>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-chalk-mut">Select or create a ranking to edit</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Analysis Tab ───────────────────────────────────────────────── */

function AnalysisTab() {
  return <DraftValuePanel />;
}
