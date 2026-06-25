WITH weekly AS (
  SELECT
    concat(game_name, '#', tag_line)               AS player,
    date_trunc('week', game_creation)::date         AS week_start,
    round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS avg_kda,
    row_number() OVER (
      PARTITION BY concat(game_name, '#', tag_line)
      ORDER BY date_trunc('week', game_creation)::date DESC
    ) AS week_rank
  FROM v_player_match_stats
  GROUP BY 1, 2
)
SELECT player, week_start, avg_kda
FROM weekly
WHERE week_rank <= 26
ORDER BY player, week_start;
