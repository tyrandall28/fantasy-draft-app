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
  bye_week: number;
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
