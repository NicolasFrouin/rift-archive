SELECT
  concat(game_name, '#', tag_line) AS player,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
  round(avg(kills::numeric), 2) AS avg_kills,
  round(avg(deaths::numeric), 2) AS avg_deaths,
  round(avg(assists::numeric), 2) AS avg_assists,
  round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS avg_kda
FROM v_player_match_stats
GROUP BY 1
ORDER BY games DESC;
