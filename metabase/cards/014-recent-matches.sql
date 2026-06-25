SELECT
  concat(game_name, '#', tag_line) AS player,
  game_creation,
  champion,
  position,
  queue_id,
  win,
  kills,
  deaths,
  assists,
  cs,
  gold_earned,
  damage_to_champions,
  vision_score,
  round(game_duration_seconds / 60.0, 1) AS duration_min
FROM v_player_match_stats
ORDER BY game_creation DESC
LIMIT 30;
