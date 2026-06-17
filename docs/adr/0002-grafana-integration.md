# 0002 — Add Grafana for dashboards and historical views

- **Status:** proposed
- **Date:** 2026-06-17

## Context

The system stores all metrics in Supabase/PostgreSQL (`servers` and `metrics`
tables, see ADR-0001). The only visualization today is the custom browser
dashboard (`frontend/`), fed live by the backend over Server-Sent Events (SSE).

That dashboard is push-based and bespoke. We want, in addition, a standard
observability tool that can:

- show CPU/RAM/Disk over time, with rich charts and time-range selection,
- let a user pick a specific server,
- show each server's status (`OK` / `WARNING` / `CRITICAL`) and detect stale
  servers (no recent data),
- give us historical/aggregate views the custom dashboard does not focus on.

Grafana fits this directly: it has a native PostgreSQL data source, so it can
read the same `metrics` table the backend writes to, in parallel with the
existing dashboard. The existing time index `idx_metrics_server_created
(server_id, created_at DESC)` already suits Grafana's time-series queries.

### Constraint that shapes this decision

The status thresholds (`cpu>=90 → CRITICAL`, etc.) and the stale rule (no data
for an hour → `UNKNOWN`) currently live in **backend code**
(`src/metrics.ts`, `frontend/script.js`), **not** in the database. Grafana only
sees raw numeric columns. To make Grafana fully equivalent to the frontend, this
logic must be re-expressed as SQL inside Grafana's panels.

## Decision

Add Grafana as an additional, read-only consumer of the database. Specifically:

1. **Grafana complements, it does not replace.** The `frontend/` + SSE dashboard
   stays in place. Grafana runs in parallel against the same database. Nothing is
   removed. (If Grafana later proves sufficient, removing the frontend becomes a
   separate, low-risk decision — but that is explicitly *not* decided here.)

2. **Grafana is feature-complete, not just charts.** Grafana reproduces
   everything the frontend offers: CPU/RAM/Disk time-series, a server-selection
   dropdown, per-server status, and stale detection. The status and stale logic
   are implemented as **SQL queries in Grafana panels** (see Appendix), since
   that logic is not stored in the database.

3. **Data source: direct PostgreSQL.** Grafana connects straight to the `db`
   container (`db:5432`) using Grafana's native Postgres data source, not via
   PostgREST/Kong. Direct SQL is required for the `CASE`-based status/stale
   queries and joins; doing that over REST would be far more awkward.

4. **Dedicated read-only database user.** Grafana connects as a new role
   `grafana_ro` with `SELECT`-only on `public.servers` and `public.metrics`
   (and `USAGE` on the schema). It must never be able to write. This follows
   least-privilege: leaked Grafana credentials cannot modify monitoring data.

5. **Everything provisioned as code.** The data source and the dashboard are
   committed as provisioning files (YAML for the data source, JSON for the
   dashboard) and loaded automatically on container start. No click-ops, no
   reliance on the Grafana volume for the definition. This matches the
   "infrastructure as code / one `docker compose up`" approach of ADR-0001.

6. **Dashboard reachable in the browser over a locally exposed port.** The
   Grafana service publishes port `3000`, so the dashboard is opened directly at
   `http://localhost:3000` — no separate build or hosting step. Like the SSE
   frontend (`:8081`), it is a browser-facing surface served from the Compose
   stack. The port is published for local use only; the admin login and a
   non-default password gate access.

### Proposed shape (for the future implementation)

```
grafana/
  provisioning/
    datasources/
      postgres.yml          # points at db:5432 as grafana_ro
    dashboards/
      dashboards.yml         # tells Grafana to load JSON from this folder
      server-monitoring.json # the dashboard definition (panels below)
supabase/
  volumes/db/
    grafana-role.sql         # CREATE ROLE grafana_ro + GRANT SELECT, init-mounted
```

A `grafana` service is added to `supabase/docker-compose.yml`:

- image `grafana/grafana` (pinned), `depends_on: db (service_healthy)`
- port `3000:3000` published for the browser
- mounts `./grafana/provisioning` and a `grafana_data` volume
- env: `GF_SECURITY_ADMIN_PASSWORD`, plus the `grafana_ro` password passed to
  the provisioned data source via env substitution

## Consequences

- One more container, started by the same Compose stack. Grafana is moderately
  heavy but far lighter than the Supabase stack already running.
- **Status/stale logic is now defined in two places** — backend code *and*
  Grafana SQL. They can drift. Accepted for now; a future improvement is to push
  the thresholds into the database (e.g. a view or generated column) so there is
  a single source of truth.
- Grafana is **pull-based** (auto-refresh, e.g. every 5–10s), not push. For
  CPU/RAM monitoring this reads as "near real-time" and is fine. True
  sub-second push remains the job of the SSE frontend — another reason both
  coexist.
- The `grafana-role.sql` init mount runs only on a fresh data volume (same
  caveat as the schema in ADR-0001); a rebuilt volume re-creates the role.
- Port `3000` is published. The default admin password must be set via env and
  changed for anything beyond local use.
- Using a read-only role keeps Grafana from ever corrupting the metrics, even
  though it shares the database with the backend.

## Relationship to tracing

This ADR covers **metrics visualization only**. Distributed tracing (e.g.
Zipkin) is a separate concern — it shows how a single request flows across the
agent → backend → database, not aggregate resource usage — and requires code
instrumentation rather than just reading the database. It will be decided in a
future ADR-0003. Note that if that ADR chooses Grafana Tempo as the tracing
backend, traces could be viewed through this same Grafana instance; that
trade-off (Zipkin vs. Tempo) is deferred to ADR-0003 and does not change any
decision here.

---

## Appendix — reference SQL for the panels

These are the queries the provisioned dashboard will use. `$__timeFilter()` and
`$server` are Grafana macros/variables.

### Server-selection variable (`$server` dropdown)

```sql
SELECT hostname FROM public.servers ORDER BY hostname;
```

### CPU over time (time-series panel, filtered by selected server)

```sql
SELECT m.created_at AS "time", s.hostname, m.cpu_usage
FROM public.metrics m
JOIN public.servers s ON s.id = m.server_id
WHERE $__timeFilter(m.created_at)
  AND s.hostname = '$server'
ORDER BY m.created_at;
```

(RAM and Disk panels are identical with `ram_usage` / `disk_usage`.)

### Current status of each server (mirrors src/metrics.ts thresholds)

```sql
SELECT
  s.hostname,
  latest.cpu_usage,
  latest.ram_usage,
  latest.disk_usage,
  CASE
    WHEN latest.created_at < NOW() - INTERVAL '1 hour' THEN 'UNKNOWN'
    WHEN latest.cpu_usage >= 90 OR latest.ram_usage >= 90 OR latest.disk_usage >= 95 THEN 'CRITICAL'
    WHEN latest.cpu_usage >= 70 OR latest.ram_usage >= 75 OR latest.disk_usage >= 80 THEN 'WARNING'
    ELSE 'OK'
  END AS status
FROM public.servers s
JOIN LATERAL (
  SELECT cpu_usage, ram_usage, disk_usage, created_at
  FROM public.metrics
  WHERE server_id = s.id
  ORDER BY created_at DESC
  LIMIT 1
) latest ON TRUE
ORDER BY s.hostname;
```

> The threshold and stale (1 hour) values are copied from `src/metrics.ts` and
> `frontend/script.js` (`STALE_THRESHOLD_MS = 60 * 60 * 1000`). If those change,
> this query must be updated too — the drift risk noted under Consequences.

### Read-only role (init-mounted as grafana-role.sql)

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grafana_ro') THEN
    CREATE ROLE grafana_ro LOGIN PASSWORD 'CHANGE_ME_VIA_ENV';
  END IF;
END$$;

GRANT USAGE ON SCHEMA public TO grafana_ro;
GRANT SELECT ON public.servers, public.metrics TO grafana_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO grafana_ro;
```
