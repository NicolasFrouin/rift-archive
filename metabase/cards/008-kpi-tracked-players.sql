SELECT count(DISTINCT concat(game_name, '#', tag_line)) AS players
FROM v_player_match_stats;
