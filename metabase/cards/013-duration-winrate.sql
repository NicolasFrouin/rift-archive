SELECT
  concat(game_name, '#', tag_line) AS player,
  CASE
    WHEN game_duration_seconds < 1200 THEN '0-20 min'
    WHEN game_duration_seconds < 1800 THEN '20-30 min'
    WHEN game_duration_seconds < 2400 THEN '30-40 min'
    ELSE '40+ min'
  END                               AS duration_bucket,
  count(*)                          AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
WHERE game_duration_seconds > 0
GROUP BY 1, 2
ORDER BY player, duration_bucket;
