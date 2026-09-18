import { useEffect, useRef, useState } from "react";
import { apiFetch } from "../api/client";
import WeeklyTrendChart from "./analytics/WeeklyTrendChart";
import PlayerHeadshot from "./analytics/PlayerHeadshot";
import PositionDataNotice from "./analytics/PositionDataNotice";
import { positionNotice } from "../lib/positionData";
import { ABSENCE_LABEL, ABSENCE_MARK, weekStatus } from "../lib/weeklyTimeline";
import type { PlayerDetail, PlayerWeekly } from "../types";

function formatHeight(inches: number | null): string {
  if (!inches) return "—";
  return `${Math.floor(inches / 12)}'${inches % 12}"`;
}

function stat(val: number | null | undefined, suffix = ""): string {
  if (val == null) return "—";
  return `${val}${suffix}`;
}

function pct(val: number | null | undefined): string {
  if (val == null) return "—";
  return `${(val * 100).toFixed(1)}%`;
}

interface Props {
  playerId: number | null;
  onClose: () => void;
}

export default function PlayerCard({ playerId, onClose }: Props) {
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [weekly, setWeekly] = useState<PlayerWeekly[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"seasons" | "weekly">("seasons");
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<number | undefined>(undefined);

  // Hover alone covers the wheel case, but not a keyboard scroll or a fling on
  // a trackpad where the pointer has left the card.
  const handleScroll = () => {
    setScrolling(true);
    window.clearTimeout(scrollTimer.current);
    scrollTimer.current = window.setTimeout(() => setScrolling(false), 700);
  };

  useEffect(() => () => window.clearTimeout(scrollTimer.current), []);

  useEffect(() => {
    if (!playerId) {
      setDetail(null);
      setWeekly([]);
      setSelectedSeason(null);
      return;
    }
    setLoading(true);
    apiFetch<PlayerDetail>(`/api/players/${playerId}/stats`)
      .then((d) => {
        setDetail(d);
        if (d.seasons.length > 0) {
          setSelectedSeason(d.seasons[0].season);
        }
      })
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [playerId]);

  useEffect(() => {
    if (!playerId || !selectedSeason) {
      setWeekly([]);
      return;
    }
    apiFetch<PlayerWeekly[]>(`/api/players/${playerId}/weekly?season=${selectedSeason}`)
      .then(setWeekly)
      .catch(() => setWeekly([]));
  }, [playerId, selectedSeason]);

  if (!playerId) return null;

  const pos = detail?.player.position ?? "";
  const cardNotice = positionNotice(pos);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Card */}
      <div
        onScroll={handleScroll}
        className={`relative w-full max-w-4xl max-h-[88vh] bg-ink-800 border border-ink-600 rounded-2xl overflow-y-auto shadow-2xl scroll-quiet${
          scrolling ? " is-scrolling" : ""
        }`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-chalk-mut hover:text-chalk transition-colors z-10 text-xl"
        >
          ✕
        </button>

        {loading && (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent" />
          </div>
        )}

        {detail && (
          <>
            {/* Header */}
            <div className="p-6 pb-5 border-b border-ink-600">
              {/* Who he is on the left, what he is on the right, centred against
                  each other. pr-10 keeps the bio clear of the close button. */}
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 pr-10">
                <div className="flex items-center gap-4 min-w-0">
                  <PlayerHeadshot
                    url={detail.player.headshot_url}
                    name={detail.player.full_name}
                    size={72}
                  />
                  <div className="min-w-0">
                    <h2 className="text-2xl font-bold text-chalk truncate">{detail.player.full_name}</h2>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-sm font-bold px-2.5 py-0.5 rounded bg-ink-700 text-chalk-dim">
                        {pos}
                      </span>
                      <span className="text-base text-chalk-dim">{detail.player.nfl_team}</span>
                      {detail.player.bye_week != null && detail.player.bye_week > 0 && (
                        <span className="text-sm text-chalk-mut">BYE {detail.player.bye_week}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bio */}
                {detail.bio && (
                  <div className="flex flex-1 flex-wrap justify-start sm:justify-end gap-x-5 gap-y-1 text-sm text-chalk-mut sm:text-right [&>span]:whitespace-nowrap">
                    {detail.bio.height_inches && <span>{formatHeight(detail.bio.height_inches)}</span>}
                    {detail.bio.weight_lbs && <span>{detail.bio.weight_lbs} lbs</span>}
                    {detail.bio.college && <span>{detail.bio.college}</span>}
                    {detail.bio.draft_year && (
                      <span>
                        {detail.bio.draft_year} R{detail.bio.draft_round} P{detail.bio.draft_pick}
                        {detail.bio.draft_overall && ` (#${detail.bio.draft_overall})`}
                      </span>
                    )}
                    {detail.bio.birth_date && (
                      <span>Age {Math.floor((Date.now() - new Date(detail.bio.birth_date).getTime()) / 31557600000)}</span>
                    )}
                  </div>
                )}
              </div>

              {/* Combine measurables */}
              {detail.bio && (detail.bio.forty_yard_dash || detail.bio.vertical_jump || detail.bio.broad_jump || detail.bio.bench_press) && (
                <div className="mt-4 grid grid-cols-3 sm:grid-cols-6 gap-2">
                  {[
                    { label: "40-Yard", value: detail.bio.forty_yard_dash?.toFixed(2), suffix: "s" },
                    { label: "Vertical", value: detail.bio.vertical_jump?.toFixed(1), suffix: '"' },
                    { label: "Broad", value: detail.bio.broad_jump, suffix: '"' },
                    { label: "Bench", value: detail.bio.bench_press, suffix: " reps" },
                    { label: "3-Cone", value: detail.bio.three_cone?.toFixed(2), suffix: "s" },
                    { label: "Shuttle", value: detail.bio.shuttle?.toFixed(2), suffix: "s" },
                  ]
                    .filter((m) => m.value != null)
                    .map((m) => (
                      <div key={m.label} className="bg-ink-700 rounded-lg px-3 py-2 text-center">
                        <p className="text-xs text-chalk-mut uppercase">{m.label}</p>
                        <p className="text-lg font-bold text-chalk stat-num">
                          {m.value}{m.suffix}
                        </p>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Why this position's stats are thin or absent — shown before the
                tabs so a defense's empty tables read as expected, not broken. */}
            {cardNotice && (
              <div className="px-6 pt-4">
                <PositionDataNotice notice={cardNotice} variant="compact" />
              </div>
            )}

            {/* Tabs. Same segmented control as the analytics header, one surface
                step down so the track reads as recessed into the card. */}
            <div className="px-6 py-4 border-b border-ink-600">
              <div className="seg-inset">
                <button
                  onClick={() => setTab("seasons")}
                  className={`seg-item flex-1 ${tab === "seasons" ? "seg-item-active" : ""}`}
                >
                  Season Stats
                </button>
                <button
                  onClick={() => setTab("weekly")}
                  className={`seg-item flex-1 ${tab === "weekly" ? "seg-item-active" : ""}`}
                >
                  Game Log
                </button>
              </div>
            </div>

            {/* Season selector (for weekly tab) */}
            {tab === "weekly" && detail.seasons.length > 0 && (
              <div className="px-6 py-4 border-b border-ink-600">
                <div className="flex gap-1.5 flex-wrap">
                  {detail.seasons.map((s) => (
                    <button
                      key={s.season}
                      onClick={() => setSelectedSeason(s.season)}
                      className={`text-sm px-3 py-1.5 rounded transition-colors stat-num ${
                        selectedSeason === s.season
                          ? "bg-accent text-accent-ink"
                          : "bg-ink-700 text-chalk-mut hover:text-chalk-dim"
                      }`}
                    >
                      {s.season}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Season Stats Tab */}
            {tab === "seasons" && (
              <div className="px-6 py-5">
                {detail.seasons.length === 0 ? (
                  <p className="text-base text-chalk-mut text-center py-10">
                    {cardNotice?.level === "none"
                      ? "No season stats exist for this position."
                      : "No stats available"}
                  </p>
                ) : (
                  <SeasonTable seasons={detail.seasons} position={pos} />
                )}
              </div>
            )}

            {/* Weekly Tab */}
            {tab === "weekly" && (
              <div className="px-6 py-5">
                {weekly.length === 0 ? (
                  <p className="text-base text-chalk-mut text-center py-10">No game logs available</p>
                ) : (
                  <>
                    <WeeklyTrendChart weeks={weekly} position={pos} />
                    <WeeklyTable weeks={weekly} position={pos} />
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function SeasonTable({ seasons, position }: { seasons: PlayerDetail["seasons"]; position: string }) {
  const isQB = position === "QB";
  const isK = position === "K";
  const isSkill = ["RB", "WR", "TE"].includes(position);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-chalk-mut border-b border-ink-600">
            <th className="text-left py-2.5 px-2 font-medium">Year</th>
            <th className="text-center py-2.5 px-2 font-medium">G</th>
            {isQB && (
              <>
                <th className="text-center py-2.5 px-2 font-medium">Cmp/Att</th>
                <th className="text-center py-2.5 px-2 font-medium">Pass Yds</th>
                <th className="text-center py-2.5 px-2 font-medium">TD</th>
                <th className="text-center py-2.5 px-2 font-medium">INT</th>
                <th className="text-center py-2.5 px-2 font-medium">Rush Yds</th>
                <th className="text-center py-2.5 px-2 font-medium">Rush TD</th>
              </>
            )}
            {isSkill && (
              <>
                {(position === "RB") && (
                  <>
                    <th className="text-center py-2.5 px-2 font-medium">Rush</th>
                    <th className="text-center py-2.5 px-2 font-medium">Rush Yds</th>
                    <th className="text-center py-2.5 px-2 font-medium">Rush TD</th>
                  </>
                )}
                <th className="text-center py-2.5 px-2 font-medium">Tgt</th>
                <th className="text-center py-2.5 px-2 font-medium">Rec</th>
                <th className="text-center py-2.5 px-2 font-medium">Rec Yds</th>
                <th className="text-center py-2.5 px-2 font-medium">Rec TD</th>
                <th className="text-center py-2.5 px-2 font-medium">Tgt%</th>
              </>
            )}
            {isK && (
              <>
                <th className="text-center py-2.5 px-2 font-medium">FGM/A</th>
                <th className="text-center py-2.5 px-2 font-medium">Long</th>
                <th className="text-center py-2.5 px-2 font-medium">XPM/A</th>
              </>
            )}
            <th className="text-center py-2.5 px-2 font-medium">PPR</th>
            <th className="text-center py-2.5 px-2 font-medium">Snp%</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.season} className="border-b border-ink-700 hover:bg-ink-700 transition-colors">
              <td className="py-2.5 px-2 font-medium text-chalk-dim stat-num">{s.season}</td>
              <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.games_played)}</td>
              {isQB && (
                <>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.pass_completions)}/{stat(s.pass_attempts)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.pass_yards)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk font-semibold stat-num">{stat(s.pass_tds)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.interceptions)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.rush_yards)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk font-semibold stat-num">{stat(s.rush_tds)}</td>
                </>
              )}
              {isSkill && (
                <>
                  {position === "RB" && (
                    <>
                      <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.rush_attempts)}</td>
                      <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.rush_yards)}</td>
                      <td className="text-center py-2.5 px-2 text-chalk font-semibold stat-num">{stat(s.rush_tds)}</td>
                    </>
                  )}
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.targets)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.receptions)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.rec_yards)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk font-semibold stat-num">{stat(s.rec_tds)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-mut stat-num">{pct(s.target_share)}</td>
                </>
              )}
              {isK && (
                <>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.fg_made)}/{stat(s.fg_att)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.fg_long)}</td>
                  <td className="text-center py-2.5 px-2 text-chalk-dim stat-num">{stat(s.pat_made)}/{stat(s.pat_att)}</td>
                </>
              )}
              <td className="text-center py-2.5 px-2 text-accent font-semibold stat-num">{s.fantasy_points_ppr?.toFixed(1) ?? "—"}</td>
              <td className="text-center py-2.5 px-2 text-chalk-mut stat-num">{pct(s.snap_pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WeeklyTable({ weeks, position }: { weeks: PlayerWeekly[]; position: string }) {
  const isQB = position === "QB";
  const isK = position === "K";
  const isSkill = ["RB", "WR", "TE"].includes(position);

  // Stat columns after Wk and Opp, so a "did not play" row can span them.
  let statColumns = 1; // PPR
  if (isQB) statColumns += 5;
  if (isSkill) statColumns += position === "RB" ? 7 : 4;
  if (isK) statColumns += 3;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-chalk-mut border-b border-ink-600">
            <th className="text-left py-2.5 px-2 font-medium">Wk</th>
            <th className="text-left py-2.5 px-2 font-medium">Opp</th>
            {isQB && (
              <>
                <th className="text-center py-2.5 px-2 font-medium">C/A</th>
                <th className="text-center py-2.5 px-2 font-medium">Yds</th>
                <th className="text-center py-2.5 px-2 font-medium">TD</th>
                <th className="text-center py-2.5 px-2 font-medium">INT</th>
                <th className="text-center py-2.5 px-2 font-medium">RuYd</th>
              </>
            )}
            {isSkill && (
              <>
                {position === "RB" && (
                  <>
                    <th className="text-center py-2.5 px-2 font-medium">Ru</th>
                    <th className="text-center py-2.5 px-2 font-medium">RuYd</th>
                    <th className="text-center py-2.5 px-2 font-medium">RuTD</th>
                  </>
                )}
                <th className="text-center py-2.5 px-2 font-medium">Tgt</th>
                <th className="text-center py-2.5 px-2 font-medium">Rec</th>
                <th className="text-center py-2.5 px-2 font-medium">Yds</th>
                <th className="text-center py-2.5 px-2 font-medium">TD</th>
              </>
            )}
            {isK && (
              <>
                <th className="text-center py-2.5 px-2 font-medium">FG</th>
                <th className="text-center py-2.5 px-2 font-medium">Long</th>
                <th className="text-center py-2.5 px-2 font-medium">XP</th>
              </>
            )}
            <th className="text-center py-2.5 px-2 font-medium">PPR</th>
          </tr>
        </thead>
        <tbody>
          {weeks.map((w) => {
            // A week he sat out gets a row of its own rather than being skipped,
            // so the table tells the same story as the chart above it: the weeks
            // are continuous and the absences are visible.
            const status = weekStatus(w);
            if (status !== "played") {
              return (
                <tr key={w.week} className="border-b border-ink-700 bg-ink-700/30">
                  <td className="py-2 px-2 stat-num text-chalk-mut">{w.week}</td>
                  <td className="py-2 px-2 text-chalk-mut">
                    {status === "bye" ? "—" : w.opponent ?? "—"}
                  </td>
                  <td
                    colSpan={statColumns}
                    className="py-2 px-2 text-center italic"
                    style={{
                      color:
                        status === "missed"
                          ? ABSENCE_MARK.missed
                          : "var(--color-chalk-mut)",
                    }}
                  >
                    {ABSENCE_LABEL[status]}
                  </td>
                </tr>
              );
            }
            return (
            <tr key={w.week} className="border-b border-ink-700 hover:bg-ink-700 transition-colors">
              <td className="py-2 px-2 stat-num text-chalk-mut">{w.week}</td>
              <td className="py-2 px-2 text-chalk-dim">{w.opponent ?? "—"}</td>
              {isQB && (
                <>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.pass_completions)}/{stat(w.pass_attempts)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.pass_yards)}</td>
                  <td className="text-center py-2 px-2 text-chalk font-semibold stat-num">{stat(w.pass_tds)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.interceptions)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.rush_yards)}</td>
                </>
              )}
              {isSkill && (
                <>
                  {position === "RB" && (
                    <>
                      <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.rush_attempts)}</td>
                      <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.rush_yards)}</td>
                      <td className="text-center py-2 px-2 text-chalk font-semibold stat-num">{stat(w.rush_tds)}</td>
                    </>
                  )}
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.targets)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.receptions)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.rec_yards)}</td>
                  <td className="text-center py-2 px-2 text-chalk font-semibold stat-num">{stat(w.rec_tds)}</td>
                </>
              )}
              {isK && (
                <>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.fg_made)}/{stat(w.fg_att)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.fg_long)}</td>
                  <td className="text-center py-2 px-2 text-chalk-dim stat-num">{stat(w.pat_made)}/{stat(w.pat_att)}</td>
                </>
              )}
              <td className="text-center py-2 px-2 text-accent font-semibold stat-num">{w.fantasy_points_ppr?.toFixed(1) ?? "—"}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
