SELECT
  date_trunc('week', game_creation)::date AS week_start,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
GROUP BY 1
ORDER BY 1 DESC
LIMIT 26;
