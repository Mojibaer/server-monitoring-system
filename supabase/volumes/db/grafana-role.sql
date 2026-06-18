-- Grafana read-only database role.
-- Runs once, in the Postgres init directory, AFTER schema.sql — so the tables
-- already exist and are owned by the same init superuser that runs this file,
-- which is why the GRANTs below succeed on a fresh volume.
-- The password is taken from the GRAFANA_DB_PASSWORD environment variable
-- (same pattern as jwt.sql) so it stays in sync with the .env / compose value.

\set grafana_password `echo "$GRAFANA_DB_PASSWORD"`

-- Create the role only if missing (CREATE ROLE has no IF NOT EXISTS), using the
-- env password. \gexec runs the SELECT-built statement.
SELECT format('CREATE ROLE grafana_ro LOGIN PASSWORD %L', :'grafana_password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_ro')
\gexec

-- Always (re)set login + password so re-runs stay consistent.
ALTER ROLE grafana_ro LOGIN PASSWORD :'grafana_password';

-- Read-only access to the monitoring data.
GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO grafana_ro;

-- Cover any tables created later in the public schema, too.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_ro;
