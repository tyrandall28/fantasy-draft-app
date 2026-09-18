import { useEffect, useState } from "react";
import { apiFetch } from "../api/client";
import WeeklyTrendChart from "./analytics/WeeklyTrendChart";
import PositionDataNotice from "./analytics/PositionDataNotice";
import { positionNotice } from "../lib/positionData";
import { ABSENCE_LABEL, ABSENCE_MARK, weekStatus } from "../lib/weeklyTimeline";
import type { PlayerDetail, PlayerWeekly } from "../types";

const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-emerald-400",
  WR: "text-sky-400",
  TE: "text-amber-400",
  K: "text-purple-400",
  DST: "text-slate-400",
};

const POS_BADGE: Record<string, string> = {
  QB: "bg-red-500/20 text-red-400",
  RB: "bg-emerald-500/20 text-emerald-400",
  WR: "bg-sky-500/20 text-sky-400",
  TE: "bg-amber-500/20 text-amber-400",
  K: "bg-purple-500/20 text-purple-400",
  DST: "bg-slate-500/20 text-slate-400",
};

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
      <div className="relative w-full max-w-2xl max-h-[85vh] bg-[#12141b] border border-white/10 rounded-2xl overflow-y-auto shadow-2xl">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-500 hover:text-white transition-colors z-10 text-lg"
        >
          ✕
        </button>

        {loading && (
          <div className="flex justify-center items-center h-48">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-sky-500" />
          </div>
        )}

        {detail && (
          <>
            {/* Header */}
            <div className="p-5 pb-4 border-b border-white/5">
              <div className="flex items-start gap-4">
                {detail.player.headshot_url ? (
                  <img
                    src={detail.player.headshot_url}
                    alt={detail.player.full_name}
                    className="w-16 h-16 rounded-full bg-white/5 object-cover flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center flex-shrink-0">
                    <span className={`text-lg font-bold ${POS_COLOR[pos] ?? "text-slate-400"}`}>{pos}</span>
                  </div>
                )}
                <div className="min-w-0">
                  <h2 className="text-xl font-bold text-white truncate">{detail.player.full_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded ${POS_BADGE[pos] ?? "bg-slate-500/20 text-slate-400"}`}>
                      {pos}
                    </span>
                    <span className="text-sm text-slate-400">{detail.player.nfl_team}</span>
                    {detail.player.bye_week != null && detail.player.bye_week > 0 && (
                      <span className="text-xs text-slate-600">BYE {detail.player.bye_week}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Bio row */}
              {detail.bio && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
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

              {/* Combine measurables */}
              {detail.bio && (detail.bio.forty_yard_dash || detail.bio.vertical_jump || detail.bio.broad_jump || detail.bio.bench_press) && (
                <div className="mt-3 grid grid-cols-3 gap-2">
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
                      <div key={m.label} className="bg-white/[0.03] rounded-lg px-2.5 py-1.5 text-center">
                        <p className="text-[10px] text-slate-500 uppercase">{m.label}</p>
                        <p className="text-sm font-bold text-slate-200">
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
              <div className="p-3 pb-0">
                <PositionDataNotice notice={cardNotice} variant="compact" />
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b border-white/5">
              <button
                onClick={() => setTab("seasons")}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  tab === "seasons" ? "text-sky-400 border-b-2 border-sky-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Season Stats
              </button>
              <button
                onClick={() => setTab("weekly")}
                className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                  tab === "weekly" ? "text-sky-400 border-b-2 border-sky-400" : "text-slate-500 hover:text-slate-300"
                }`}
              >
                Game Log
              </button>
            </div>

            {/* Season selector (for weekly tab) */}
            {tab === "weekly" && detail.seasons.length > 0 && (
              <div className="p-3 border-b border-white/5">
                <div className="flex gap-1.5 flex-wrap">
                  {detail.seasons.map((s) => (
                    <button
                      key={s.season}
                      onClick={() => setSelectedSeason(s.season)}
                      className={`text-xs px-2.5 py-1 rounded transition-colors ${
                        selectedSeason === s.season
                          ? "bg-sky-600 text-white"
                          : "bg-white/5 text-slate-400 hover:bg-white/10"
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
              <div className="p-3">
                {detail.seasons.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">
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
              <div className="p-3">
                {weekly.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-8">No game logs available</p>
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
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-white/5">
            <th className="text-left py-2 px-1.5 font-medium">Year</th>
            <th className="text-center py-2 px-1.5 font-medium">G</th>
            {isQB && (
              <>
                <th className="text-center py-2 px-1.5 font-medium">Cmp/Att</th>
                <th className="text-center py-2 px-1.5 font-medium">Pass Yds</th>
                <th className="text-center py-2 px-1.5 font-medium">TD</th>
                <th className="text-center py-2 px-1.5 font-medium">INT</th>
                <th className="text-center py-2 px-1.5 font-medium">Rush Yds</th>
                <th className="text-center py-2 px-1.5 font-medium">Rush TD</th>
              </>
            )}
            {isSkill && (
              <>
                {(position === "RB") && (
                  <>
                    <th className="text-center py-2 px-1.5 font-medium">Rush</th>
                    <th className="text-center py-2 px-1.5 font-medium">Rush Yds</th>
                    <th className="text-center py-2 px-1.5 font-medium">Rush TD</th>
                  </>
                )}
                <th className="text-center py-2 px-1.5 font-medium">Tgt</th>
                <th className="text-center py-2 px-1.5 font-medium">Rec</th>
                <th className="text-center py-2 px-1.5 font-medium">Rec Yds</th>
                <th className="text-center py-2 px-1.5 font-medium">Rec TD</th>
                <th className="text-center py-2 px-1.5 font-medium">Tgt%</th>
              </>
            )}
            {isK && (
              <>
                <th className="text-center py-2 px-1.5 font-medium">FGM/A</th>
                <th className="text-center py-2 px-1.5 font-medium">Long</th>
                <th className="text-center py-2 px-1.5 font-medium">XPM/A</th>
              </>
            )}
            <th className="text-center py-2 px-1.5 font-medium">PPR</th>
            <th className="text-center py-2 px-1.5 font-medium">Snp%</th>
          </tr>
        </thead>
        <tbody>
          {seasons.map((s) => (
            <tr key={s.season} className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
              <td className="py-2 px-1.5 font-medium text-slate-200">{s.season}</td>
              <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.games_played)}</td>
              {isQB && (
                <>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.pass_completions)}/{stat(s.pass_attempts)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.pass_yards)}</td>
                  <td className="text-center py-2 px-1.5 text-emerald-400 font-medium">{stat(s.pass_tds)}</td>
                  <td className="text-center py-2 px-1.5 text-red-400">{stat(s.interceptions)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.rush_yards)}</td>
                  <td className="text-center py-2 px-1.5 text-emerald-400 font-medium">{stat(s.rush_tds)}</td>
                </>
              )}
              {isSkill && (
                <>
                  {position === "RB" && (
                    <>
                      <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.rush_attempts)}</td>
                      <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.rush_yards)}</td>
                      <td className="text-center py-2 px-1.5 text-emerald-400 font-medium">{stat(s.rush_tds)}</td>
                    </>
                  )}
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.targets)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.receptions)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.rec_yards)}</td>
                  <td className="text-center py-2 px-1.5 text-emerald-400 font-medium">{stat(s.rec_tds)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-400">{pct(s.target_share)}</td>
                </>
              )}
              {isK && (
                <>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.fg_made)}/{stat(s.fg_att)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.fg_long)}</td>
                  <td className="text-center py-2 px-1.5 text-slate-300">{stat(s.pat_made)}/{stat(s.pat_att)}</td>
                </>
              )}
              <td className="text-center py-2 px-1.5 text-sky-400 font-bold">{s.fantasy_points_ppr?.toFixed(1) ?? "—"}</td>
              <td className="text-center py-2 px-1.5 text-slate-400">{pct(s.snap_pct)}</td>
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
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-white/5">
            <th className="text-left py-2 px-1.5 font-medium">Wk</th>
            <th className="text-left py-2 px-1.5 font-medium">Opp</th>
            {isQB && (
              <>
                <th className="text-center py-2 px-1.5 font-medium">C/A</th>
                <th className="text-center py-2 px-1.5 font-medium">Yds</th>
                <th className="text-center py-2 px-1.5 font-medium">TD</th>
                <th className="text-center py-2 px-1.5 font-medium">INT</th>
                <th className="text-center py-2 px-1.5 font-medium">RuYd</th>
              </>
            )}
            {isSkill && (
              <>
                {position === "RB" && (
                  <>
                    <th className="text-center py-2 px-1.5 font-medium">Ru</th>
                    <th className="text-center py-2 px-1.5 font-medium">RuYd</th>
                    <th className="text-center py-2 px-1.5 font-medium">RuTD</th>
                  </>
                )}
                <th className="text-center py-2 px-1.5 font-medium">Tgt</th>
                <th className="text-center py-2 px-1.5 font-medium">Rec</th>
                <th className="text-center py-2 px-1.5 font-medium">Yds</th>
                <th className="text-center py-2 px-1.5 font-medium">TD</th>
              </>
            )}
            {isK && (
              <>
                <th className="text-center py-2 px-1.5 font-medium">FG</th>
                <th className="text-center py-2 px-1.5 font-medium">Long</th>
                <th className="text-center py-2 px-1.5 font-medium">XP</th>
              </>
            )}
            <th className="text-center py-2 px-1.5 font-medium">PPR</th>
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
                <tr key={w.week} className="border-b border-white/[0.03] bg-white/[0.015]">
                  <td className="py-1.5 px-1.5 font-mono text-slate-600">{w.week}</td>
                  <td className="py-1.5 px-1.5 text-slate-600">
                    {status === "bye" ? "—" : w.opponent ?? "—"}
                  </td>
                  <td
                    colSpan={statColumns}
                    className="py-1.5 px-1.5 text-center italic"
                    style={{ color: status === "missed" ? ABSENCE_MARK.missed : "#475569" }}
                  >
                    {ABSENCE_LABEL[status]}
                  </td>
                </tr>
              );
            }
            return (
            <tr key={w.week} className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors">
              <td className="py-1.5 px-1.5 font-mono text-slate-400">{w.week}</td>
              <td className="py-1.5 px-1.5 text-slate-300">{w.opponent ?? "—"}</td>
              {isQB && (
                <>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.pass_completions)}/{stat(w.pass_attempts)}</td>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.pass_yards)}</td>
                  <td className="text-center py-1.5 px-1.5 text-emerald-400 font-medium">{stat(w.pass_tds)}</td>
                  <td className="text-center py-1.5 px-1.5 text-red-400">{stat(w.interceptions)}</td>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.rush_yards)}</td>
                </>
              )}
              {isSkill && (
                <>
                  {position === "RB" && (
                    <>
                      <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.rush_attempts)}</td>
                      <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.rush_yards)}</td>
                      <td className="text-center py-1.5 px-1.5 text-emerald-400 font-medium">{stat(w.rush_tds)}</td>
                    </>
                  )}
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.targets)}</td>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.receptions)}</td>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.rec_yards)}</td>
                  <td className="text-center py-1.5 px-1.5 text-emerald-400 font-medium">{stat(w.rec_tds)}</td>
                </>
              )}
              {isK && (
                <>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.fg_made)}/{stat(w.fg_att)}</td>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.fg_long)}</td>
                  <td className="text-center py-1.5 px-1.5 text-slate-300">{stat(w.pat_made)}/{stat(w.pat_att)}</td>
                </>
              )}
              <td className="text-center py-1.5 px-1.5 text-sky-400 font-bold">{w.fantasy_points_ppr?.toFixed(1) ?? "—"}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
