-- Runs once on first Postgres init (mounted into /docker-entrypoint-initdb.d).
-- POSTGRES_DB already creates the `lol` database; here we add Metabase's own.
SELECT 'CREATE DATABASE metabase'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'metabase')\gexec
