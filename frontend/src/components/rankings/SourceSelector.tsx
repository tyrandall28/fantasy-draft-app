import { useState } from "react";

interface Source {
  value: string;
  label: string;
  player_count?: number;
}

interface Props {
  sources: Source[];
  onCreate: (source: string, name: string) => void;
  creating: boolean;
}

export default function SourceSelector({ sources, onCreate, creating }: Props) {
  const [source, setSource] = useState(sources[0]?.value ?? "");
  const [name, setName] = useState("");

  if (!source && sources.length > 0) {
    setSource(sources[0].value);
  }

  const handleCreate = () => {
    if (!name.trim() || !source) return;
    onCreate(source, name.trim());
    setName("");
  };

  return (
    <div className="space-y-2">
      <select
        value={source}
        onChange={(e) => setSource(e.target.value)}
        className="w-full bg-[#1a1d26] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50"
      >
        {sources.length === 0 && (
          <option value="" disabled>No sources available</option>
        )}
        {sources.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label} {s.player_count ? `(${s.player_count})` : ""}
          </option>
        ))}
      </select>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ranking name"
        className="w-full bg-[#1a1d26] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500/50"
        onKeyDown={(e) => e.key === "Enter" && handleCreate()}
      />
      <button
        onClick={handleCreate}
        disabled={creating || !name.trim() || !source}
        className="w-full bg-sky-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-sky-500 disabled:opacity-50 transition-colors"
      >
        {creating ? "Creating..." : "Create Ranking"}
      </button>
    </div>
  );
}
