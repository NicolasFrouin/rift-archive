SELECT
  concat(game_name, '#', tag_line) AS player,
  champion,
  count(*) AS games,
  round(100.0 * avg(CASE WHEN win THEN 1 ELSE 0 END), 2) AS winrate_pct,
  round(avg((kills + assists)::numeric / NULLIF(deaths, 0)), 2) AS avg_kda,
  round(avg(cs::numeric), 2) AS avg_cs
FROM v_player_match_stats
WHERE champion IS NOT NULL
  AND champion <> ''
GROUP BY 1, 2
HAVING count(*) >= 5
ORDER BY player, games DESC;
