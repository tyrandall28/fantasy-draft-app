import type { PlayerWeekly } from "../types";

/**
 * Weeks a player didn't play, and how to draw them.
 *
 * `/api/players/{id}/weekly` returns a slot for every week of the season, not
 * just the games played, each tagged with a status. Before that, a chart drawn
 * from the response closed the gaps: Dalton Kincaid's 2025 was twelve evenly
 * spaced dots, his week 10 sat next to his week 14, and a month on the sideline
 * read as a normal week-to-week step. Nothing on the chart said he'd been out.
 *
 * The treatment is a faint vertical band per absent week -- red for a game his
 * team played without him, grey for a bye -- so a run of missed weeks reads as
 * one block rather than four separate marks.
 */

export type WeekStatus = "played" | "missed" | "bye" | "inactive";
export type AbsentStatus = Exclude<WeekStatus, "played">;

/** Tolerates a response from before `status` existed by assuming it was played. */
export function weekStatus(w: PlayerWeekly): WeekStatus {
  const s = w.status;
  return s === "missed" || s === "bye" || s === "inactive" ? s : "played";
}

export function isPlayed(w: PlayerWeekly): boolean {
  return weekStatus(w) === "played";
}

/* Literal values rather than var(--...) because two of these are composed into
 * rgba() fills. They track the tokens in index.css: --color-fall for a missed
 * game, the warm chalk greys for everything else. They were slate-tinted, which
 * put a cool cast on the one part of a chart that isn't chalk. */

/** Band fills. Low alpha: these sit behind the line, they don't compete with it. */
export const ABSENCE_FILL: Record<AbsentStatus, string> = {
  missed: "rgba(240,115,107,0.10)", // --color-fall
  bye: "rgba(154,150,140,0.07)", // --color-chalk-dim
  // He wasn't in the league yet -- the faintest thing that still reads as "not nothing".
  inactive: "rgba(154,150,140,0.04)",
};

/** Colour of the mark drawn at the top of a band, and of that week's axis label. */
export const ABSENCE_MARK: Record<AbsentStatus, string> = {
  missed: "#f0736b", // --color-fall
  bye: "#6b6862", // --color-chalk-mut
  inactive: "#4a4843",
};

/** Axis-label colour, dimmed for any week without a game. */
export function weekTickFill(status: WeekStatus): string {
  if (status === "played") return "#6b6862";
  if (status === "missed") return "#9c6a66"; // --color-fall, pulled back toward the greys
  return "#4a4843";
}

export interface AbsenceRun {
  /** First and last week of the run, inclusive. */
  start: number;
  end: number;
  status: AbsentStatus;
}

/**
 * Contiguous same-status absences merged into runs.
 *
 * Merging matters visually: three adjacent bands drawn separately leave faint
 * antialiasing seams between them, and the point of the band treatment is that
 * a month out looks like one month.
 */
export function absenceRuns(weeks: PlayerWeekly[]): AbsenceRun[] {
  const runs: AbsenceRun[] = [];
  for (const w of weeks) {
    const status = weekStatus(w);
    if (status === "played") continue;
    const last = runs[runs.length - 1];
    if (last && last.status === status && last.end === w.week - 1) {
      last.end = w.week;
    } else {
      runs.push({ start: w.week, end: w.week, status });
    }
  }
  return runs;
}

export interface AbsenceCounts {
  played: number;
  missed: number;
  /** Games his team played, so "played of teamGames" is a fair fraction. */
  teamGames: number;
}

export function absenceCounts(weeks: PlayerWeekly[]): AbsenceCounts {
  let played = 0;
  let missed = 0;
  for (const w of weeks) {
    const status = weekStatus(w);
    if (status === "played") played++;
    else if (status === "missed") missed++;
  }
  return { played, missed, teamGames: played + missed };
}

/** Week span to plot, so the axis covers the whole season rather than the played games. */
export function weekDomain(weeks: PlayerWeekly[]): [number, number] {
  if (weeks.length === 0) return [1, 1];
  const nums = weeks.map((w) => w.week);
  return [Math.min(...nums), Math.max(...nums)];
}

export const ABSENCE_LABEL: Record<AbsentStatus, string> = {
  missed: "Did not play",
  bye: "Bye week",
  inactive: "Not yet in the NFL",
};
