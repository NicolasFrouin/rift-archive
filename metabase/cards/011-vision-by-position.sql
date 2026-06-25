SELECT
  concat(game_name, '#', tag_line) AS player,
  position,
  count(*)                          AS games,
  round(avg(vision_score::numeric), 2) AS avg_vision
FROM v_player_match_stats
WHERE position IS NOT NULL AND position <> ''
GROUP BY 1, 2
ORDER BY player, games DESC;
