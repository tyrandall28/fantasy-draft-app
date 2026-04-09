export interface User {
  id: string;
  email: string;
  username: string;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface Player {
  id: number;
  full_name: string;
  position: string;
  nfl_team: string;
  bye_week: number | null;
  headshot_url: string | null;
}

export interface PlayerBio {
  player_id: number;
  height_inches: number | null;
  weight_lbs: number | null;
  birth_date: string | null;
  college: string | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_pick: number | null;
  draft_overall: number | null;
  years_exp: number | null;
  forty_yard_dash: number | null;
  bench_press: number | null;
  vertical_jump: number | null;
  broad_jump: number | null;
  three_cone: number | null;
  shuttle: number | null;
}

export interface PlayerSeason {
  season: number;
  games_played: number | null;
  pass_attempts: number | null;
  pass_completions: number | null;
  pass_yards: number | null;
  pass_tds: number | null;
  interceptions: number | null;
  sacks: number | null;
  pass_epa: number | null;
  rush_attempts: number | null;
  rush_yards: number | null;
  rush_tds: number | null;
  rush_fumbles: number | null;
  rush_epa: number | null;
  targets: number | null;
  receptions: number | null;
  rec_yards: number | null;
  rec_tds: number | null;
  rec_yards_after_catch: number | null;
  rec_epa: number | null;
  target_share: number | null;
  fg_made: number | null;
  fg_att: number | null;
  fg_pct: number | null;
  fg_long: number | null;
  pat_made: number | null;
  pat_att: number | null;
  special_teams_tds: number | null;
  fantasy_points: number | null;
  fantasy_points_ppr: number | null;
  snap_count: number | null;
  snap_pct: number | null;
}

export interface PlayerWeekly {
  season: number;
  week: number;
  opponent: string | null;
  team: string | null;
  pass_attempts: number | null;
  pass_completions: number | null;
  pass_yards: number | null;
  pass_tds: number | null;
  interceptions: number | null;
  rush_attempts: number | null;
  rush_yards: number | null;
  rush_tds: number | null;
  targets: number | null;
  receptions: number | null;
  rec_yards: number | null;
  rec_tds: number | null;
  rec_yards_after_catch: number | null;
  target_share: number | null;
  fg_made: number | null;
  fg_att: number | null;
  fantasy_points: number | null;
  fantasy_points_ppr: number | null;
  snap_count: number | null;
  snap_pct: number | null;
}

export interface PlayerDetail {
  player: Player;
  bio: PlayerBio | null;
  seasons: PlayerSeason[];
}

export interface BaseRankingEntry {
  id: number;
  source: string;
  player_id: number;
  rank: number;
  tier: number;
  player: Player;
}

export interface UserRanking {
  id: string;
  user_id: string;
  source: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface UserRankingEntry {
  id: number;
  ranking_id: string;
  player_id: number;
  rank: number;
  is_locked: boolean;
  player: Player;
}

export interface UserRankingDetail extends UserRanking {
  entries: UserRankingEntry[];
}

export interface League {
  id: string;
  name: string;
  invite_code: string;
  commissioner_id: string;
  team_count: number;
  roster_size: number;
  bench_size: number;
  position_slots: Record<string, number>;
  pick_time_seconds: number;
  scoring_type: string;
  bot_ranking_source: string;
  draft_order: string[] | null;
  status: "setup" | "drafting" | "completed";
  members: LeagueMember[];
}

export interface LeagueMember {
  league_id: string;
  user_id: string;
  team_name: string;
  draft_position: number | null;
  ranking_id: string | null;
  username: string;
  is_bot: boolean;
}

export interface DraftPick {
  league_id: string;
  user_id: string;
  player_id: number;
  round_num: number;
  pick_in_round: number;
  overall_pick: number;
  is_auto: boolean;
  picked_at: string;
  player: Player;
  username: string;
}

export interface PlayerDerivedStats {
  player_id: number;
  season: number;
  position: string;
  games_played: number;
  full_name: string;
  nfl_team: string;
  headshot_url: string | null;
  // Per-game rates
  ppr_per_game: number | null;
  standard_per_game: number | null;
  pass_yards_per_game: number | null;
  rush_yards_per_game: number | null;
  rec_yards_per_game: number | null;
  targets_per_game: number | null;
  receptions_per_game: number | null;
  tds_per_game: number | null;
  // Efficiency
  yards_per_carry: number | null;
  yards_per_target: number | null;
  yards_per_reception: number | null;
  catch_rate: number | null;
  completion_pct: number | null;
  td_rate: number | null;
  // Advanced
  pass_epa_per_game: number | null;
  rush_epa_per_game: number | null;
  cpoe: number | null;
  target_share: number | null;
  air_yards_per_game: number | null;
  yac_per_reception: number | null;
  snap_pct: number | null;
  // Kicking
  fg_pct: number | null;
  fg_made_per_game: number | null;
  fg_long: number | null;
  xp_pct: number | null;
  // Boom/bust
  median_ppr: number | null;
  stdev_ppr: number | null;
  // Totals
  total_tds: number | null;
  total_yards: number | null;
  fantasy_points_ppr: number | null;
}

export interface SparklinePoint {
  season: number;
  ppr_per_game: number | null;
  games_played: number;
}

export type SparklineData = Record<number, SparklinePoint[]>;

export interface DraftState {
  picks: DraftPick[];
  current_pick: number;
  current_user_id: string;
  seconds_remaining: number;
  status: "drafting" | "completed";
  draft_order: string[];
  team_count: number;
  roster_size: number;
  timer_enabled: boolean;
  bot_ids: string[];
}
