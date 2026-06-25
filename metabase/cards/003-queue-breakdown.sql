SELECT
  queue_id,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
GROUP BY 1
ORDER BY games DESC;
