-- Grafana read-only database role.
-- This user is only allowed to read monitoring data.

-- Create the Grafana database role if it does not exist.
-- If it already exists, update its password so the script can be run again safely.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_ro') THEN
    CREATE ROLE grafana_ro LOGIN PASSWORD 'grafana_password';
  ELSE
    ALTER ROLE grafana_ro LOGIN PASSWORD 'grafana_password';
  END IF;
END
$$;

-- Allow the Grafana role to access the public schema.
GRANT USAGE ON SCHEMA public TO grafana_ro;

-- Allow Grafana to read the server list and monitoring metrics.
GRANT SELECT ON TABLE public.servers TO grafana_ro;
GRANT SELECT ON TABLE public.metrics TO grafana_ro;
