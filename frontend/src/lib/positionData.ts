/**
 * What analytics data actually exists per position, and what to tell the user
 * when it doesn't.
 *
 * Two positions are incomplete for reasons that have nothing to do with our
 * pipeline being broken, so the UI should say which is which rather than
 * rendering an empty chart and letting the user assume a bug:
 *
 *   K   - Field-goal stats are complete and correct. nflverse's fantasy-point
 *         totals exclude kicking scoring, so PPR/G and total PPR sit at ~0 and
 *         are not worth showing or sorting by. Fixable on our side by scoring
 *         kickers from the distance buckets nflverse does provide (tracked in
 *         TODO.md).
 *   DST  - No data at all. nflverse doesn't treat team defenses as players, so
 *         they have no gsis_id and therefore no bio, weekly, season, or derived
 *         rows. They exist only as draftable entries in the ranking lists.
 *
 * Keeping the copy here means the analytics page, the player card, and the
 * rankings panel all explain it the same way.
 */

export type PositionDataLevel =
  /** Full stats and fantasy scoring. */
  | "full"
  /** Real stats, but some headline metrics are missing. */
  | "partial"
  /** No statistical data of any kind. */
  | "none";

export interface PositionDataNotice {
  level: PositionDataLevel;
  /** Short suffix for a tab or chip, e.g. "soon". */
  badge: string;
  /** One-line headline for the notice panel. */
  title: string;
  /** Why it's missing and what still works. */
  detail: string;
}

const NOTICES: Record<string, PositionDataNotice> = {
  K: {
    level: "partial",
    badge: "soon",
    title: "Kicker scoring isn't wired up yet",
    detail:
      "Field-goal and extra-point stats below are accurate. Fantasy points aren't " +
      "computed for kickers yet, so PPR/G and total PPR read 0 — sort by FG/G or FG% " +
      "instead.",
  },
  DST: {
    level: "none",
    badge: "soon",
    title: "Team defense stats aren't available yet",
    detail:
      "Our stats source treats defenses as teams rather than players, so there are no " +
      "game logs, season totals, or analytics for them. You can still rank and draft " +
      "them — there's just nothing to chart.",
  },
};

/** The notice for a position, or null when its data is complete. */
export function positionNotice(position: string | null | undefined): PositionDataNotice | null {
  if (!position) return null;
  return NOTICES[position.toUpperCase()] ?? null;
}

/** True when a position has no statistical data at all. */
export function hasNoStats(position: string | null | undefined): boolean {
  return positionNotice(position)?.level === "none";
}

/**
 * True when fantasy points are populated for a position.
 *
 * False for K (nflverse doesn't score kicking) and DST (no data at all). Any
 * PPR-based display — a per-game column, a career trend line, a VOR curve —
 * would read as a flat zero for these, which looks like a broken chart rather
 * than missing scoring. Check this before rendering one.
 */
export function hasFantasyPoints(position: string | null | undefined): boolean {
  return positionNotice(position) === null;
}

/** True when a position's data is incomplete in any way. */
export function isIncomplete(position: string | null | undefined): boolean {
  return positionNotice(position) !== null;
}
