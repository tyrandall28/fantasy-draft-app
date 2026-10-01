import { useState } from "react";

export interface SearchResult {
  id: number;
  name: string;
  /** Muted text after the name: team, or position and team. */
  detail: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  results: SearchResult[];
  onPick: (id: number) => void;
  placeholder: string;
}

/**
 * Text input with a results dropdown. Owns only the dropdown's open state and
 * keyboard highlight; where the results come from is the caller's business --
 * the compare tab filters rows already on the page, the find box asks the API.
 */
export default function PlayerSearchBox({ value, onChange, results, onPick, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const showResults = open && results.length > 0;

  const pick = (id: number) => {
    onPick(id);
    setActive(0);
  };

  return (
    <div className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onChange("");
          } else if (!showResults) {
            return;
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter") {
            pick(results[Math.min(active, results.length - 1)].id);
          }
        }}
        className="bg-ink-800 border border-ink-600 text-chalk text-sm rounded-lg px-3 py-1.5 w-64 placeholder:text-chalk-mut focus:outline-none focus:border-chalk-mut"
      />
      {showResults && (
        <div className="absolute top-full left-0 mt-1 w-full panel-float z-30 overflow-hidden">
          {results.map((r, i) => (
            <button
              key={r.id}
              // Keep focus in the input, so its blur doesn't close the list
              // before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(r.id)}
              onMouseEnter={() => setActive(i)}
              className={`w-full text-left px-3 py-2 text-sm ${
                i === active ? "bg-ink-700 text-chalk" : "text-chalk-dim"
              }`}
            >
              {r.name}
              <span className="text-chalk-mut ml-2 text-xs">{r.detail}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
