SELECT
  concat(game_name, '#', tag_line) AS player,
  position,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
  round(avg(kills::numeric), 2) AS avg_kills,
  round(avg(deaths::numeric), 2) AS avg_deaths,
  round(avg(assists::numeric), 2) AS avg_assists
FROM v_player_match_stats
WHERE position IS NOT NULL
  AND position <> ''
GROUP BY 1, 2
ORDER BY player, games DESC;
