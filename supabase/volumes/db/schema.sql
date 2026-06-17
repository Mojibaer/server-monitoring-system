-- Server Monitoring — schema (structure only, no seed data).
-- Mounted into the Postgres init directory; runs once on a fresh data volume.

CREATE TABLE IF NOT EXISTS public.servers (
    id          SERIAL PRIMARY KEY,
    hostname    TEXT NOT NULL UNIQUE,
    ip_address  TEXT,
    last_seen   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.metrics (
    id          SERIAL PRIMARY KEY,
    server_id   INTEGER NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
    cpu_usage   FLOAT NOT NULL,
    ram_usage   FLOAT NOT NULL,
    disk_usage  FLOAT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_server_created
    ON public.metrics (server_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_created_at
    ON public.metrics (created_at DESC);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.servers TO anon, authenticated, service_role;
GRANT ALL ON public.metrics TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
