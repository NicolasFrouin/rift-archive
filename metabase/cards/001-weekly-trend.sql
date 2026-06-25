WITH weekly AS (
  SELECT
    concat(game_name, '#', tag_line) AS player,
    date_trunc('week', game_creation)::date AS week_start,
    count(*) AS games,
    round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
    row_number() OVER (
      PARTITION BY concat(game_name, '#', tag_line)
      ORDER BY date_trunc('week', game_creation)::date DESC
    ) AS week_rank
  FROM v_player_match_stats
  GROUP BY 1, 2
)
SELECT
  player,
  week_start,
  games,
  winrate_pct
FROM weekly
WHERE week_rank <= 26
ORDER BY player, week_start DESC;
