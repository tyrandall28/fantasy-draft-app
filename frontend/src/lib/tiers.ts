import type { PlayerDerivedStats } from "../types";

/** Starters per position in a standard 12-team league. */
export const TIER_SIZE = 12;

/**
 * The metric that defines a position's pecking order.
 *
 * Kickers have no PPR in nflverse, so ranking them by it sorts a column of
 * zeros -- the badge would read `K7` in an order that means nothing.
 */
export function valueMetricFor(position: string): keyof PlayerDerivedStats {
  return position === "K" ? "fg_made_per_game" : "ppr_per_game";
}

/**
 * Is the table currently sorted in a way that makes the top 12 a real tier?
 *
 * Sorted by PPR/G, rows 1-12 are the startable RB1s. Sorted by Catch%, they're
 * just the twelve best at catching, which is not a tier and shouldn't be
 * labelled as one.
 */
export function isTierSort(position: string, sortBy: string, sortDir: string): boolean {
  if (sortDir !== "desc") return false;
  const totals: string[] = position === "K" ? [] : ["fantasy_points_ppr"];
  return sortBy === valueMetricFor(position) || totals.includes(sortBy);
}

/** Positional rank by value metric, keyed by player id. Independent of sort. */
export function positionalRanks(
  players: PlayerDerivedStats[],
  position: string
): Map<number, number> {
  const metric = valueMetricFor(position);
  const ranked = [...players].sort((a, b) => {
    const aVal = a[metric] as number | null;
    const bVal = b[metric] as number | null;
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    return bVal - aVal;
  });
  return new Map(ranked.map((p, i) => [p.player_id, i + 1]));
}

export interface TierBand {
  label: string;
  range: string;
}

/** The band that opens the group starting at `index`, or null mid-group. */
export function tierBandAt(
  index: number,
  position: string,
  isTier: boolean
): TierBand | null {
  if (index % TIER_SIZE !== 0) return null;
  const tier = index / TIER_SIZE + 1;
  const range = `${index + 1}-${index + TIER_SIZE}`;
  return { label: isTier ? `${position}${tier}` : range, range };
}
