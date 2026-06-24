-- Derived views for Metabase. Applied idempotently on worker boot (CREATE OR
-- REPLACE), so analysis can evolve WITHOUT re-fetching anything from Riot —
-- the raw match-v5 JSON in `matches.raw` is the floor.

-- One row per (monitored player, match): the participant entry that matches the
-- player's puuid, with common stats flattened out for easy slicing/charting.
CREATE OR REPLACE VIEW v_player_match_stats AS
SELECT
  pm.puuid,
  pl.game_name,
  pl.tag_line,
  m.match_id,
  m.game_creation,
  m.queue_id,
  m.game_version,
  (p.participant->>'championName')               AS champion,
  (p.participant->>'teamPosition')               AS position,
  (p.participant->>'win')::boolean               AS win,
  (p.participant->>'kills')::int                 AS kills,
  (p.participant->>'deaths')::int                AS deaths,
  (p.participant->>'assists')::int               AS assists,
  (p.participant->>'totalMinionsKilled')::int
    + (p.participant->>'neutralMinionsKilled')::int AS cs,
  (p.participant->>'goldEarned')::int            AS gold_earned,
  (p.participant->>'totalDamageDealtToChampions')::int AS damage_to_champions,
  (p.participant->>'visionScore')::int           AS vision_score,
  ((m.raw->'info'->>'gameDuration')::int)        AS game_duration_seconds
FROM player_matches pm
JOIN matches m ON m.match_id = pm.match_id
JOIN players pl ON pl.puuid = pm.puuid
CROSS JOIN LATERAL jsonb_array_elements(m.raw->'info'->'participants') AS p(participant)
WHERE p.participant->>'puuid' = pm.puuid;
