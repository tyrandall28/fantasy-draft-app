# Database Schema — Fantasy Draft App

Visual reference for all tables in the database.

---

### `users`

| Column          | Type         | Constraints              | Example                                |
|-----------------|--------------|--------------------------|----------------------------------------|
| id              | UUID         | PK                       | `669fcda0-5f19-439b-bdfe-1cc73ee42910` |
| email           | VARCHAR(255) | UNIQUE, NOT NULL, INDEX  | `tyler@example.com`                    |
| username        | VARCHAR(50)  | UNIQUE, NOT NULL, INDEX  | `Tyler`                                |
| hashed_password | VARCHAR(255) | NOT NULL                 | `$2b$12$...`                           |
| oauth_provider  | VARCHAR(50)  | NULLABLE                 | `google` (future)                      |
| oauth_id        | VARCHAR(255) | NULLABLE                 | (future)                               |
| created_at      | TIMESTAMPTZ  | NOT NULL                 | `2026-03-18 14:30:00+00`               |

---

### `players`

| Column       | Type         | Constraints            | Example          |
|--------------|--------------|------------------------|------------------|
| id           | INTEGER      | PK, AUTO               | `1`              |
| full_name    | VARCHAR(100) | NOT NULL               | `Ja'Marr Chase`  |
| position     | VARCHAR(10)  | NOT NULL, INDEX        | `WR`             |
| nfl_team     | VARCHAR(5)   | NOT NULL               | `CIN`            |
| bye_week     | INTEGER      | NULLABLE               | `7`              |
| gsis_id      | VARCHAR(50)  | UNIQUE, NULLABLE, INDEX| `00-0036900`     |
| espn_id      | INTEGER      | UNIQUE, NULLABLE       | `4362628`        |
| sleeper_id   | VARCHAR(50)  | UNIQUE, NULLABLE       | `7564`           |
| yahoo_id     | INTEGER      | UNIQUE, NULLABLE       | `33404`          |
| pfr_id       | VARCHAR(50)  | UNIQUE, NULLABLE       | `ChasJa00`       |
| headshot_url | VARCHAR(500) | NULLABLE               | `https://...`    |

> External IDs enable cross-source matching without name parsing. Populated via `nflreadpy` from nflverse data.

---

### `base_rankings`

Stores imported rankings from external sources (ESPN, Sleeper, etc.).

| Column    | Type        | Constraints          | Example        |
|-----------|-------------|----------------------|----------------|
| id        | INTEGER     | PK, AUTO             | `1`            |
| source    | VARCHAR(50) | NOT NULL, INDEX      | `espn_ppr`     |
| player_id | INTEGER     | FK → players.id, INDEX | `1`          |
| rank      | INTEGER     | NOT NULL             | `3`            |
| tier      | INTEGER     | DEFAULT 1            | `1`            |

---

### `user_rankings`

Each user's custom ranking list (copied from a base ranking, then reordered via drag-and-drop).

| Column     | Type         | Constraints          | Example                                |
|------------|--------------|----------------------|----------------------------------------|
| id         | UUID         | PK                   | `51c75e09-162e-4f22-a563-1ff96caa0576` |
| user_id    | UUID         | FK → users.id, INDEX | `669fcda0-...`                         |
| source     | VARCHAR(50)  | NOT NULL             | `espn_ppr`                             |
| name       | VARCHAR(100) | NOT NULL             | `My ESPN Rankings`                     |
| created_at | TIMESTAMPTZ  | NOT NULL             | `2026-03-18 14:35:00+00`               |
| updated_at | TIMESTAMPTZ  | NOT NULL             | `2026-03-19 10:00:00+00`               |

---

### `user_ranking_entries`

Individual rows within a user's custom ranking list.

| Column     | Type    | Constraints                    | Example                                |
|------------|---------|--------------------------------|----------------------------------------|
| id         | INTEGER | PK, AUTO                       | `1`                                    |
| ranking_id | UUID    | FK → user_rankings.id, INDEX   | `51c75e09-...`                         |
| player_id  | INTEGER | FK → players.id                | `1`                                    |
| rank       | INTEGER | NOT NULL                       | `3`                                    |
| is_locked  | BOOLEAN | DEFAULT FALSE                  | `false`                                |

---

### `leagues`

| Column             | Type         | Constraints         | Example                                |
|--------------------|--------------|---------------------|----------------------------------------|
| id                 | UUID         | PK                  | `4bfd35c7-4294-4322-bc90-0e8563169b8d` |
| name               | VARCHAR(100) | NOT NULL            | `Tyler's League`                       |
| invite_code        | VARCHAR(12)  | UNIQUE, NOT NULL    | `ABC123XYZ`                            |
| commissioner_id    | UUID         | FK → users.id       | `669fcda0-...`                         |
| team_count         | INTEGER      | DEFAULT 10          | `12`                                   |
| roster_size        | INTEGER      | DEFAULT 15          | `15`                                   |
| bench_size         | INTEGER      | DEFAULT 6           | `6`                                    |
| position_slots     | JSONB        | NOT NULL            | `{"QB":1,"RB":2,"WR":2,"TE":1,...}`   |
| pick_time_seconds  | INTEGER      | DEFAULT 90          | `60`                                   |
| scoring_type       | VARCHAR(20)  | DEFAULT 'ppr'       | `ppr`                                  |
| draft_order        | JSONB        | NULLABLE            | `["uuid1","uuid2",...]`               |
| bot_ranking_source | VARCHAR(50)  | DEFAULT 'espn_ppr'  | `sleeper_ppr`                          |
| status             | VARCHAR(20)  | DEFAULT 'setup'     | `drafting`                             |
| created_at         | TIMESTAMPTZ  | NOT NULL            | `2026-03-19 09:00:00+00`               |

---

### `league_members`

| Column         | Type        | Constraints                   | Example            |
|----------------|-------------|-------------------------------|--------------------|
| id             | INTEGER     | PK, AUTO                      | `1`                |
| league_id      | UUID        | FK → leagues.id, INDEX        | `4bfd35c7-...`     |
| user_id        | UUID        | FK → users.id                 | `669fcda0-...`     |
| team_name      | VARCHAR(50) | DEFAULT 'My Team'             | `Tyler's Team`     |
| draft_position | INTEGER     | NULLABLE                      | `3`                |
| ranking_id     | UUID        | FK → user_rankings.id, NULL   | `51c75e09-...`     |
| is_bot         | BOOLEAN     | DEFAULT FALSE                 | `false`            |

---

### `draft_picks`

| Column       | Type        | Constraints              | Example                  |
|--------------|-------------|--------------------------|--------------------------|
| id           | INTEGER     | PK, AUTO                 | `1`                      |
| league_id    | UUID        | FK → leagues.id, INDEX   | `4bfd35c7-...`           |
| user_id      | UUID        | FK → users.id            | `669fcda0-...`           |
| player_id    | INTEGER     | FK → players.id          | `1`                      |
| round_num    | INTEGER     | NOT NULL                 | `1`                      |
| pick_in_round| INTEGER     | NOT NULL                 | `3`                      |
| overall_pick | INTEGER     | NOT NULL                 | `3`                      |
| is_auto      | BOOLEAN     | DEFAULT FALSE            | `false`                  |
| picked_at    | TIMESTAMPTZ | NOT NULL                 | `2026-03-19 09:05:30+00` |

---

### `player_bio`

One row per player. Physical measurables, draft capital, combine results. Populated from nflverse ff_playerids + combine data.

| Column           | Type         | Constraints              | Example              |
|------------------|--------------|--------------------------|----------------------|
| id               | INTEGER      | PK, AUTO                 | `1`                  |
| player_id        | INTEGER      | FK → players.id, UNIQUE  | `1`                  |
| height_inches    | INTEGER      | NULLABLE                 | `72`  (6'0")         |
| weight_lbs       | INTEGER      | NULLABLE                 | `208`                |
| birth_date       | DATE         | NULLABLE                 | `2000-03-16`         |
| college          | VARCHAR(100) | NULLABLE                 | `LSU`                |
| draft_year       | INTEGER      | NULLABLE                 | `2021`               |
| draft_round      | INTEGER      | NULLABLE                 | `1`                  |
| draft_pick       | INTEGER      | NULLABLE                 | `5`                  |
| years_exp        | INTEGER      | NULLABLE                 | `4`                  |
| forty_yard_dash  | FLOAT        | NULLABLE                 | `4.38`               |
| bench_press      | INTEGER      | NULLABLE                 | `20`   (reps)        |
| vertical_jump    | FLOAT        | NULLABLE                 | `41.0` (inches)      |
| broad_jump       | INTEGER      | NULLABLE                 | `132`  (inches)      |
| three_cone       | FLOAT        | NULLABLE                 | `6.90` (seconds)     |
| shuttle          | FLOAT        | NULLABLE                 | `4.15` (seconds)     |

**Example rows:**

| player_id | height | weight | college   | draft_year | draft_round | draft_pick | forty | vert | broad |
|-----------|--------|--------|-----------|------------|-------------|------------|-------|------|-------|
| 1         | 72     | 208    | LSU       | 2021       | 1           | 5          | 4.38  | 41.0 | 132   |
| 2         | 73     | 215    | Alabama   | 2020       | 1           | 17         | 4.27  | 42.0 | 136   |
| 3         | 77     | 230    | Stanford  | 2022       | 2           | 50         | 4.55  | NULL | NULL  |

> Many combine fields will be NULL — not all players participated in every drill, and UDFAs may have no combine data at all. That's expected.

---

### `player_seasons`

One row per player per season. Aggregated from weekly stats. Career stats at a glance.

| Column              | Type    | Constraints                        | Example  |
|---------------------|---------|------------------------------------|----------|
| id                  | INTEGER | PK, AUTO                           | `1`      |
| player_id           | INTEGER | FK → players.id, INDEX             | `1`      |
| season              | INTEGER | NOT NULL, INDEX                    | `2024`   |
| games_played        | INTEGER | NULLABLE                           | `17`     |
| games_started       | INTEGER | NULLABLE                           | `17`     |
| **— Passing —**     |         |                                    |          |
| pass_attempts       | INTEGER | NULLABLE                           | `NULL`   |
| pass_completions    | INTEGER | NULLABLE                           | `NULL`   |
| pass_yards          | INTEGER | NULLABLE                           | `NULL`   |
| pass_tds            | INTEGER | NULLABLE                           | `NULL`   |
| interceptions       | INTEGER | NULLABLE                           | `NULL`   |
| sacks               | INTEGER | NULLABLE                           | `NULL`   |
| passer_rating       | FLOAT   | NULLABLE                           | `NULL`   |
| **— Rushing —**     |         |                                    |          |
| rush_attempts       | INTEGER | NULLABLE                           | `NULL`   |
| rush_yards          | INTEGER | NULLABLE                           | `NULL`   |
| rush_tds            | INTEGER | NULLABLE                           | `NULL`   |
| fumbles             | INTEGER | NULLABLE                           | `NULL`   |
| yards_per_carry     | FLOAT   | NULLABLE                           | `NULL`   |
| **— Receiving —**   |         |                                    |          |
| targets             | INTEGER | NULLABLE                           | `127`    |
| receptions          | INTEGER | NULLABLE                           | `100`    |
| rec_yards           | INTEGER | NULLABLE                           | `1,456`  |
| rec_tds             | INTEGER | NULLABLE                           | `12`     |
| catch_pct           | FLOAT   | NULLABLE                           | `78.7`   |
| yards_after_catch   | INTEGER | NULLABLE                           | `620`    |
| **— Fantasy —**     |         |                                    |          |
| fantasy_points_ppr  | FLOAT   | NULLABLE                           | `321.6`  |
| fantasy_points_half | FLOAT   | NULLABLE                           | `271.6`  |
| fantasy_points_std  | FLOAT   | NULLABLE                           | `221.6`  |
| **— Usage —**       |         |                                    |          |
| snap_count          | INTEGER | NULLABLE                           | `1020`   |
| snap_pct            | FLOAT   | NULLABLE                           | `95.2`   |
| target_share        | FLOAT   | NULLABLE                           | `28.3`   |
| UNIQUE(player_id, season) |   |                                    |          |

**Example rows** (showing a WR — passing columns are all NULL):

| player_id | season | gp | targets | rec | rec_yards | rec_tds | catch_pct | fpts_ppr | snap_pct |
|-----------|--------|----|---------|-----|-----------|---------|-----------|----------|----------|
| 1         | 2024   | 17 | 127     | 100 | 1456      | 12      | 78.7      | 321.6    | 95.2     |
| 1         | 2023   | 16 | 145     | 101 | 1216      | 7       | 69.7      | 261.6    | 93.8     |
| 1         | 2022   | 16 | 95      | 60  | 956       | 9       | 63.2      | 201.6    | 89.1     |
| 1         | 2021   | 17 | 128     | 81  | 1455      | 13      | 63.3      | 304.5    | 82.0     |

**Example rows** (showing a QB — receiving columns are mostly NULL):

| player_id | season | gp | pass_att | pass_comp | pass_yds | pass_tds | ints | rush_yds | rush_tds | fpts_ppr |
|-----------|--------|----|----------|-----------|----------|----------|------|----------|----------|----------|
| 50        | 2024   | 17 | 564      | 383       | 4839     | 41       | 12   | 360      | 2        | 401.5    |
| 50        | 2023   | 16 | 551      | 370       | 4183     | 27       | 14   | 389      | 3        | 342.3    |

---

### `player_weekly_stats`

One row per player per game. Same stat columns as player_seasons but for a single game. Includes snap counts merged from nflverse snap_counts data.

| Column              | Type        | Constraints                        | Example     |
|---------------------|-------------|------------------------------------|-------------|
| id                  | INTEGER     | PK, AUTO                           | `1`         |
| player_id           | INTEGER     | FK → players.id, INDEX             | `1`         |
| season              | INTEGER     | NOT NULL, INDEX                    | `2024`      |
| week                | INTEGER     | NOT NULL, INDEX                    | `1`         |
| opponent            | VARCHAR(5)  | NULLABLE                           | `BUF`       |
| home_away           | VARCHAR(4)  | NULLABLE                           | `home`      |
| team_score          | INTEGER     | NULLABLE                           | `27`        |
| opp_score           | INTEGER     | NULLABLE                           | `24`        |
| **— Passing —**     |             |                                    |             |
| pass_attempts       | INTEGER     | NULLABLE                           | `NULL`      |
| pass_completions    | INTEGER     | NULLABLE                           | `NULL`      |
| pass_yards          | INTEGER     | NULLABLE                           | `NULL`      |
| pass_tds            | INTEGER     | NULLABLE                           | `NULL`      |
| interceptions       | INTEGER     | NULLABLE                           | `NULL`      |
| sacks               | INTEGER     | NULLABLE                           | `NULL`      |
| **— Rushing —**     |             |                                    |             |
| rush_attempts       | INTEGER     | NULLABLE                           | `NULL`      |
| rush_yards          | INTEGER     | NULLABLE                           | `NULL`      |
| rush_tds            | INTEGER     | NULLABLE                           | `NULL`      |
| fumbles             | INTEGER     | NULLABLE                           | `NULL`      |
| **— Receiving —**   |             |                                    |             |
| targets             | INTEGER     | NULLABLE                           | `11`        |
| receptions          | INTEGER     | NULLABLE                           | `8`         |
| rec_yards           | INTEGER     | NULLABLE                           | `132`       |
| rec_tds             | INTEGER     | NULLABLE                           | `2`         |
| yards_after_catch   | INTEGER     | NULLABLE                           | `48`        |
| **— Fantasy —**     |             |                                    |             |
| fantasy_points_ppr  | FLOAT       | NULLABLE                           | `33.2`      |
| fantasy_points_half | FLOAT       | NULLABLE                           | `29.2`      |
| fantasy_points_std  | FLOAT       | NULLABLE                           | `25.2`      |
| UNIQUE(player_id, season, week) |  |                                   |             |

**Example rows** (Ja'Marr Chase, first 4 weeks of 2024):

| player_id | season | week | opponent | home/away | targets | rec | rec_yds | rec_tds | fpts_ppr |
|-----------|--------|------|----------|-----------|---------|-----|---------|---------|----------|
| 1         | 2024   | 1    | BUF      | home      | 11      | 8   | 132     | 2       | 33.2     |
| 1         | 2024   | 2    | @KC      | away      | 7       | 4   | 56      | 0       | 9.6      |
| 1         | 2024   | 3    | WSH      | home      | 9       | 7   | 118     | 1       | 25.8     |
| 1         | 2024   | 4    | @CAR     | away      | 8       | 6   | 89      | 1       | 20.9     |

---

## TABLE RELATIONSHIPS (visual)

```
users
  ├── 1:N → league_members       (user joins leagues)
  ├── 1:N → user_rankings        (user creates ranking lists)
  ├── 1:N → draft_picks          (user makes picks)
  └── 1:N → leagues              (user is commissioner)

players
  ├── 1:N → base_rankings        (player appears in source rankings)
  ├── 1:N → user_ranking_entries  (player appears in user lists)
  ├── 1:N → draft_picks          (player gets drafted)
  ├── 1:1 → player_bio           (NEW — physical/combine data)
  ├── 1:N → player_seasons       (NEW — yearly stat lines)
  └── 1:N → player_weekly_stats  (NEW — per-game stat lines)

leagues
  ├── 1:N → league_members       (league has members)
  └── 1:N → draft_picks          (league has picks)

user_rankings
  └── 1:N → user_ranking_entries  (list has ordered entries)
```

---

## ROW COUNTS (as of 2026-03-22)

| Table                | Rows    | Notes                               |
|----------------------|--------:|-------------------------------------|
| users                |      ~5 |                                     |
| players              |   3,305 | 367 from rankings + 2,938 from nflverse |
| base_rankings        |    ~600 | ESPN + Sleeper sources               |
| user_rankings        |      ~5 |                                     |
| user_ranking_entries |  ~1,500 |                                     |
| leagues              |      ~3 |                                     |
| league_members       |     ~30 |                                     |
| draft_picks          |    ~200 |                                     |
| player_bio           |   3,215 | Height, weight, combine, draft info  |
| player_seasons       |   3,081 | 5 seasons (2020-2024) aggregated     |
| player_weekly_stats  |  29,410 | Per-game stats with snap counts      |

> Even the largest table (player_weekly_stats) is tiny by database standards. No performance concerns.
