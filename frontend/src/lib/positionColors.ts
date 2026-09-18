/**
 * Position colours, in one place.
 *
 * Nine components each carried their own copy of this map. They had already
 * drifted -- the roster panel's was text-only, the lobby's had FLEX and BN, the
 * chart map covered four positions and the badge map six, and the draft board's
 * was a bg/border/text triple under a different name -- so a palette change
 * meant nine edits and a diff to check they still agreed.
 *
 * The values themselves live in @theme in index.css, not here: this module maps
 * a position onto them, it doesn't define them. Everything below is either a
 * Tailwind class built from those tokens or a CSS value that resolves one, so
 * there is exactly one place to change a colour.
 *
 * Where these are and aren't used: a mixed-position list (the draft board, the
 * available-player list, a roster) earns a hue, because you scan it for "where
 * are the running backs". A single-position view doesn't -- the analytics table
 * is already filtered to one position, so colouring every row the same thing
 * says nothing, and it draws in chalk instead.
 *
 * Class strings are spelled out in full rather than composed. Tailwind's
 * scanner reads raw source text, so a template literal like `bg-pos-${slug}/20`
 * produces no CSS at all -- the class has to appear literally somewhere it can
 * see it.
 */

/** Badge pills: a tinted ground with the position letters on top. */
export const POSITION_BADGE: Record<string, string> = {
  QB: "bg-pos-qb/20 text-pos-qb",
  RB: "bg-pos-rb/20 text-pos-rb",
  WR: "bg-pos-wr/20 text-pos-wr",
  TE: "bg-pos-te/20 text-pos-te",
  FLEX: "bg-pos-flex/20 text-pos-flex",
  K: "bg-pos-k/20 text-pos-k",
  DST: "bg-pos-dst/20 text-pos-dst",
  BN: "bg-pos-bn/20 text-pos-bn",
};

/** Just the text colour, for a position printed inline rather than badged. */
export const POSITION_TEXT: Record<string, string> = {
  QB: "text-pos-qb",
  RB: "text-pos-rb",
  WR: "text-pos-wr",
  TE: "text-pos-te",
  FLEX: "text-pos-flex",
  K: "text-pos-k",
  DST: "text-pos-dst",
  BN: "text-pos-bn",
};

/**
 * The draft board's cells, which colour the whole square rather than a pill:
 * a tinted ground, a saturated left edge, and the text.
 */
export const POSITION_CELL: Record<string, { bg: string; border: string; text: string }> = {
  QB: { bg: "bg-pos-qb/20", border: "border-l-pos-qb", text: "text-pos-qb" },
  RB: { bg: "bg-pos-rb/20", border: "border-l-pos-rb", text: "text-pos-rb" },
  WR: { bg: "bg-pos-wr/20", border: "border-l-pos-wr", text: "text-pos-wr" },
  TE: { bg: "bg-pos-te/20", border: "border-l-pos-te", text: "text-pos-te" },
  K: { bg: "bg-pos-k/20", border: "border-l-pos-k", text: "text-pos-k" },
  DST: { bg: "bg-pos-dst/20", border: "border-l-pos-dst", text: "text-pos-dst" },
};

/** An empty or unrecognised draft-board cell. */
export const POSITION_CELL_DEFAULT = {
  bg: "bg-ink-700",
  border: "border-l-ink-600",
  text: "text-chalk-dim",
};

/**
 * The positions that appear as series on the draft-value charts. A kicker has
 * no value curve, and a defense's is noise.
 */
export const CHART_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

const CHART_SET: ReadonlySet<string> = new Set(CHART_POSITIONS);

/** Whether this position is drawn as its own series on the value charts. */
export function isChartPosition(position: string): boolean {
  return CHART_SET.has(position);
}

/**
 * A position's colour as a CSS value, for an inline style or an SVG stroke.
 * Keyed off the same map the Tailwind classes come from -- not off
 * CHART_POSITIONS -- so a kicker's progress bar and a kicker's badge can't end
 * up two different greys.
 */
export function positionColor(position: string): string {
  return position in POSITION_TEXT
    ? `var(--color-pos-${position.toLowerCase()})`
    : "var(--color-chalk-dim)";
}

/**
 * The same colour, thinned to `percent` opacity over whatever is behind it.
 * color-mix rather than appending hex alpha, because the value is a var() and
 * you can't concatenate onto one.
 */
export function positionTint(position: string, percent: number): string {
  return `color-mix(in srgb, ${positionColor(position)} ${percent}%, transparent)`;
}

/** Badge classes for a position, falling back to neutral for anything unmapped. */
export function positionBadge(position: string): string {
  return POSITION_BADGE[position] ?? "bg-ink-700 text-chalk-dim";
}

/** Text colour for a position, falling back to neutral. */
export function positionText(position: string): string {
  return POSITION_TEXT[position] ?? "text-chalk-dim";
}
