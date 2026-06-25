SELECT
  concat(game_name, '#', tag_line) AS player,
  count(*)                          AS games,
  round(avg(cs::numeric / NULLIF(game_duration_seconds, 0) * 60), 2)                  AS cs_per_min,
  round(avg(gold_earned::numeric / NULLIF(game_duration_seconds, 0) * 60), 2)         AS gold_per_min,
  round(avg(damage_to_champions::numeric / NULLIF(game_duration_seconds, 0) * 60), 2) AS dmg_per_min,
  round(avg(vision_score::numeric), 2)                                                AS avg_vision
FROM v_player_match_stats
WHERE game_duration_seconds > 0
GROUP BY 1
ORDER BY games DESC;
