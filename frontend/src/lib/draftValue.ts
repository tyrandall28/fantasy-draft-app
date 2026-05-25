import type { PlayerDerivedStats } from "../types";

/**
 * Value Over Replacement (VOR) / Value-Based Drafting engine.
 *
 * Pure, stateless computation over a player pool. The static rankings-page
 * use case passes the full player pool; a future live-draft advisor will
 * pass `pool.filter(p => !draftedIds.has(p.id))` into the same functions.
 * No UI dependencies — keep this file framework-agnostic.
 */

export const ALL_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"] as const;
export const SCORING_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export const FLEX_POSITIONS: ReadonlySet<string> = new Set(["RB", "WR", "TE"]);

export type Position = (typeof ALL_POSITIONS)[number];
export type ScoringPosition = (typeof SCORING_POSITIONS)[number];

export type ReplacementThresholds = Record<Position, number>;
export type PositionSlots = Record<string, number>;

/** Default 12-team standard starter/bench layout. */
export const DEFAULT_POSITION_SLOTS: PositionSlots = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  FLEX: 1,
  K: 1,
  DST: 1,
  BN: 6,
};

/** Default 12-team standard league replacement thresholds. */
export const DEFAULT_12_TEAM_THRESHOLDS: ReplacementThresholds = {
  QB: 12,
  RB: 30,
  WR: 36,
  TE: 12,
  K: 12,
  DST: 12,
};

/** Minimum games played for a player to count toward the VOR pool. */
export const DEFAULT_MIN_GAMES = 6;

export interface RankedPlayer {
  player: PlayerDerivedStats;
  /** 1-based rank within the player's position, sorted by PPG descending. */
  positionRank: number;
  ppg: number;
  /** ppg − replacement_ppg for this player's position. */
  vor: number;
}

export interface PositionCurve {
  position: Position;
  /** Players at this position sorted by PPG descending, each annotated with VOR. */
  players: RankedPlayer[];
  /** PPG of the Nth-best player (or worst player if fewer than N qualify). */
  replacementPpg: number;
  /** 1-based rank used as the replacement level. */
  replacementRank: number;
}

export interface PositionPriority {
  position: Position;
  /** Average VOR of the top N players at this position. */
  topNVor: number;
  /** VOR of the #1 player at this position. */
  topPlayerVor: number;
  replacementPpg: number;
}

export interface Tier {
  tierNumber: number;
  startRank: number;
  endRank: number;
  players: RankedPlayer[];
}

export interface PositionTiers {
  position: Position;
  tiers: Tier[];
}

export interface ComputeOptions {
  thresholds?: ReplacementThresholds;
  minGames?: number;
}

function isPosition(value: string): value is Position {
  return (ALL_POSITIONS as readonly string[]).includes(value);
}

/** Group a pool by position and drop players missing PPG or below the games floor. */
function groupByPosition(
  pool: PlayerDerivedStats[],
  minGames: number
): Map<Position, PlayerDerivedStats[]> {
  const groups = new Map<Position, PlayerDerivedStats[]>();
  for (const p of pool) {
    if (!isPosition(p.position)) continue;
    if (p.ppr_per_game == null) continue;
    if (p.games_played < minGames) continue;
    const list = groups.get(p.position) ?? [];
    list.push(p);
    groups.set(p.position, list);
  }
  return groups;
}

/** Build the VOR-annotated curve for a single position's qualifying players. */
function curveForPosition(
  position: Position,
  players: PlayerDerivedStats[],
  threshold: number
): PositionCurve {
  const sorted = [...players].sort(
    (a, b) => (b.ppr_per_game ?? 0) - (a.ppr_per_game ?? 0)
  );
  const replacementIndex = Math.min(threshold - 1, sorted.length - 1);
  const replacementPpg = sorted[replacementIndex]?.ppr_per_game ?? 0;
  const ranked: RankedPlayer[] = sorted.map((player, i) => ({
    player,
    positionRank: i + 1,
    ppg: player.ppr_per_game ?? 0,
    vor: (player.ppr_per_game ?? 0) - replacementPpg,
  }));
  return {
    position,
    players: ranked,
    replacementPpg,
    replacementRank: replacementIndex + 1,
  };
}

/**
 * Compute VOR curves for every position present in the pool.
 * Pool is usually a concat of `fetchPositionData` results across positions.
 */
export function computeVOR(
  pool: PlayerDerivedStats[],
  options: ComputeOptions = {}
): PositionCurve[] {
  const thresholds = options.thresholds ?? DEFAULT_12_TEAM_THRESHOLDS;
  const minGames = options.minGames ?? DEFAULT_MIN_GAMES;
  const groups = groupByPosition(pool, minGames);
  const curves: PositionCurve[] = [];
  for (const pos of ALL_POSITIONS) {
    const players = groups.get(pos);
    if (!players || players.length === 0) continue;
    curves.push(curveForPosition(pos, players, thresholds[pos]));
  }
  return curves;
}

/**
 * Rank positions by the average VOR of their top N players.
 * Higher topNVor = steeper drop-off = greater urgency to draft early.
 */
export function computePriorityBoard(
  curves: PositionCurve[],
  topN = 5
): PositionPriority[] {
  const priorities: PositionPriority[] = curves.map((curve) => {
    const topSlice = curve.players.slice(0, topN);
    const avg = topSlice.length
      ? topSlice.reduce((sum, p) => sum + p.vor, 0) / topSlice.length
      : 0;
    return {
      position: curve.position,
      topNVor: avg,
      topPlayerVor: curve.players[0]?.vor ?? 0,
      replacementPpg: curve.replacementPpg,
    };
  });
  return priorities.sort((a, b) => b.topNVor - a.topNVor);
}

/**
 * Detect tier breaks in a PPG-descending list by finding gaps that exceed
 * `mean + k·stdev` of the gap distribution. Small inputs return a single tier.
 */
export function detectTiers(
  sortedByPpg: RankedPlayer[],
  sigmaK = 1.0
): Tier[] {
  if (sortedByPpg.length === 0) return [];
  if (sortedByPpg.length < 4) {
    return [
      {
        tierNumber: 1,
        startRank: sortedByPpg[0].positionRank,
        endRank: sortedByPpg[sortedByPpg.length - 1].positionRank,
        players: [...sortedByPpg],
      },
    ];
  }

  const gaps: number[] = [];
  for (let i = 0; i < sortedByPpg.length - 1; i++) {
    gaps.push(sortedByPpg[i].ppg - sortedByPpg[i + 1].ppg);
  }
  const mean = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const variance = gaps.reduce((s, g) => s + (g - mean) ** 2, 0) / gaps.length;
  const stdev = Math.sqrt(variance);
  const threshold = mean + sigmaK * stdev;

  const tiers: Tier[] = [];
  let tierStart = 0;
  let tierNumber = 1;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i] > threshold) {
      tiers.push({
        tierNumber,
        startRank: sortedByPpg[tierStart].positionRank,
        endRank: sortedByPpg[i].positionRank,
        players: sortedByPpg.slice(tierStart, i + 1),
      });
      tierStart = i + 1;
      tierNumber++;
    }
  }
  // Trailing tier
  tiers.push({
    tierNumber,
    startRank: sortedByPpg[tierStart].positionRank,
    endRank: sortedByPpg[sortedByPpg.length - 1].positionRank,
    players: sortedByPpg.slice(tierStart),
  });
  return tiers;
}

/**
 * Convenience: run tier detection on every curve, capped at a sensible
 * display depth (replacementRank + padding) so we don't highlight breaks
 * deep in irrelevant backup territory.
 */
export function computeAllTiers(
  curves: PositionCurve[],
  sigmaK = 1.0,
  cap?: (curve: PositionCurve) => number
): PositionTiers[] {
  return curves.map((curve) => {
    const depth = cap ? cap(curve) : curve.replacementRank + 6;
    const players = curve.players.slice(0, depth);
    return { position: curve.position, tiers: detectTiers(players, sigmaK) };
  });
}

/* ── Tier 1.5: actionable player-level view ─────────────────────── */

export interface OpenSlots {
  /** Open dedicated position slots (e.g. `{QB: 1, RB: 0, WR: 2, TE: 0}`). */
  byPosition: Record<string, number>;
  /** Open FLEX slots after picks have filled their dedicated positions. */
  flex: number;
}

/**
 * Flatten per-position VOR curves into a single cross-position ranking
 * by VOR descending — the direct answer to "who should I take right now."
 */
export function selectBestAvailable(
  curves: PositionCurve[],
  limit?: number
): RankedPlayer[] {
  const all = curves.flatMap((c) => c.players);
  all.sort((a, b) => b.vor - a.vor);
  return limit != null ? all.slice(0, limit) : all;
}

/**
 * Compute the user's remaining starter slots given their picks so far.
 * RB/WR/TE picks that exceed their dedicated slots overflow into FLEX.
 * Bench (BN) is ignored — only starter need matters for suggestion logic.
 */
export function deriveOpenSlots(
  picks: { player: { position: string } }[],
  positionSlots: PositionSlots = DEFAULT_POSITION_SLOTS
): OpenSlots {
  const byPosition: Record<string, number> = {};
  for (const pos of ALL_POSITIONS) {
    byPosition[pos] = positionSlots[pos] ?? 0;
  }
  let flex = positionSlots.FLEX ?? 0;

  for (const pick of picks) {
    const pos = pick.player.position;
    if (byPosition[pos] != null && byPosition[pos] > 0) {
      byPosition[pos]--;
    } else if (FLEX_POSITIONS.has(pos) && flex > 0) {
      flex--;
    }
    // else: would land on bench; no impact on starter slots
  }

  return { byPosition, flex };
}

/**
 * Roster slot label this player would fill — "WR2", "FLEX", "QB", etc.
 * Returns null if no starter slot is open (pick would land on the bench).
 *
 * Independent per-player snapshot — does NOT model sequential consumption.
 * If two WRs both have an open WR2 slot, both show "WR2"; we don't try to
 * predict that picking #1 would shove #2 into FLEX. That'd need a separate
 * sequential view and isn't useful in a sortable list.
 */
export function rosterSlotForPlayer(
  player: RankedPlayer,
  open: OpenSlots,
  positionSlots: PositionSlots = DEFAULT_POSITION_SLOTS
): string | null {
  const pos = player.player.position;
  const dedicatedOpen = open.byPosition[pos] ?? 0;
  const dedicatedTotal = positionSlots[pos] ?? 0;
  if (dedicatedOpen > 0) {
    const slotIndex = dedicatedTotal - dedicatedOpen + 1;
    return dedicatedTotal > 1 ? `${pos}${slotIndex}` : pos;
  }
  if (FLEX_POSITIONS.has(pos) && open.flex > 0) {
    return "FLEX";
  }
  return null;
}

export interface DraftSuggestion {
  player: RankedPlayer;
  /** Slot the player would fill, or null if no starter slot is open. */
  slot: string | null;
  /** Human-readable reasoning for the suggestion card. */
  reason: string;
}

/**
 * Pick the highest-VOR player whose position still has an open starter slot.
 * Falls back to the raw #1 best-available if every starter slot is filled.
 */
export function selectSuggestion(
  bestAvailable: RankedPlayer[],
  open: OpenSlots,
  positionSlots: PositionSlots = DEFAULT_POSITION_SLOTS
): DraftSuggestion | null {
  if (bestAvailable.length === 0) return null;
  for (const player of bestAvailable) {
    const slot = rosterSlotForPlayer(player, open, positionSlots);
    if (slot != null) {
      return {
        player,
        slot,
        reason: `highest-VOR player that fills an open starter slot (+${player.vor.toFixed(1)} VOR · fills ${slot})`,
      };
    }
  }
  const fallback = bestAvailable[0];
  return {
    player: fallback,
    slot: null,
    reason: `all starter slots filled — highest VOR available overall (+${fallback.vor.toFixed(1)} VOR)`,
  };
}
