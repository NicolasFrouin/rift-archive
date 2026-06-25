SELECT
  concat(game_name, '#', tag_line) AS player,
  queue_id,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct
FROM v_player_match_stats
GROUP BY 1, 2
ORDER BY player, games DESC;
