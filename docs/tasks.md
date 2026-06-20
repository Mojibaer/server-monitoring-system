# Docker Containerization — Implementation Overview

This document breaks the full Docker implementation into six logical blocks.
Everything (database, API gateway, backend, agents, Grafana, Zipkin) runs as a
Docker Compose service defined in [`supabase/docker-compose.yml`](../supabase/docker-compose.yml).
Only the browser dashboard (`frontend/index.html`) runs outside Docker.

The blocks are ordered by layer:

- **Blocks 1–2** — third-party Supabase images (infrastructure)
- **Blocks 3–4** — our own multi-stage-built images (backend & agents)
- **Blocks 5–6** — observability add-ons (Grafana & Zipkin)

Blocks 1 → 2 → 3 → 4 also reflect the startup order enforced by the
`depends_on` chain. Blocks 5 and 6 attach to that core.

---

## Block 1 — Supabase Database Layer (`db`)

The Postgres container — the foundation everything else depends on.

**File:** [`supabase/docker-compose.yml`](../supabase/docker-compose.yml) (service `db`)

- Image `supabase/postgres:15.8.1.085`, port `5432`.
- **Init scripts mounted as volumes** run **once** when the data volume is first
  created, in a fixed order: roles → JWT → `zzz-schema.sql` (monitoring tables)
  → `zzzz-grafana-role.sql` (read-only role). The `zzz` / `zzzz` prefixes force
  the alphabetical ordering.
- **Healthcheck** with `pg_isready` — the anchor every
  `depends_on: db: service_healthy` waits for.
- **Persistence** via the `db_data` volume.

---

## Block 2 — Supabase API Layer (`rest` + `kong`)

Turns the database into a reachable REST API. The backend writes through this.

**File:** [`supabase/docker-compose.yml`](../supabase/docker-compose.yml) (services `rest`, `kong`)

- **`rest`** (PostgREST) — auto-generates a REST API from the schema. Waits for
  `db: service_healthy`.
- **`kong`** (API gateway) — routes `/rest/v1` → PostgREST, handles key-auth, and
  is the only publicly exposed entry point (`:8000`). Has its own healthcheck
  (`kong health`).
- Together these are the "db + rest + kong" box in the architecture diagram. The
  backend talks **only to Kong** (`SUPABASE_PUBLIC_URL: http://kong:8000`), never
  directly to Postgres.

---

## Block 3 — Backend Image (Node / TypeScript)

The self-built backend image — write path + gRPC + SSE + tracing init.

**Files:** [`Dockerfile`](../Dockerfile) (root) + [`supabase/docker-compose.yml`](../supabase/docker-compose.yml) (service `backend`)

- **Multi-stage build:** the build stage compiles TS → `dist/` via
  `npm run build`, then `npm prune --omit=dev`; the runtime stage carries only
  `dist/`, runtime `node_modules`, and `proto/`.
  > Note: this is exactly where the stale-image issue lived — without `--build`,
  > an old image without `dist/tracing.js` could be reused and tracing would
  > silently do nothing.
- **Ports** `50051` (gRPC) + `8081` (SSE).
- In Compose: `depends_on` on `kong: healthy` **and** `zipkin: healthy`; the
  **OTel env** (`OTEL_EXPORTER_ZIPKIN_ENDPOINT`, `OTEL_SERVICE_NAME:
  monitoring-backend`) is the wiring that activates the tracing from Block 6.

---

## Block 4 — Client Agent Image (Python)

The self-built agent image — one image, three individualised containers.

**Files:** [`ClientAgent/Dockerfile`](../ClientAgent/Dockerfile) + [`supabase/docker-compose.yml`](../supabase/docker-compose.yml) (services `agent-*`)

- **Multi-stage build:** the build stage installs deps (grpcio, protobuf + the
  **OTel packages** `opentelemetry-sdk`, `-exporter-zipkin-json`,
  `-instrumentation-grpc`) into `/install`; the runtime stage copies only that
  plus the `.py` files.
- **One image, three services** (`agent-web-01` / `agent-db-02` / `agent-edge-03`)
  individualised via env: `AGENT_HOSTNAME`, own `mem_limit` / `cpus`, own
  `OTEL_SERVICE_NAME`.
- Each agent: `depends_on` backend (`service_started`) + zipkin
  (`service_healthy`), with the OTel endpoint set.
- The `mem_limit` / `cpus` are not cosmetic — the agent's cgroup metrics are
  measured *against exactly these limits*.

---

## Block 5 — Grafana (Metrics Read Path)

Read-only dashboards straight on the database, auto-configured via provisioning.

**Files:** [`supabase/docker-compose.yml`](../supabase/docker-compose.yml) (service `grafana`) + [`grafana/provisioning/`](../grafana/provisioning/) (3 files) + `supabase/volumes/db/grafana-role.sql`

- Image `grafana/grafana:12.3.0`, port `3000`, `depends_on: db: healthy`.
- **Provisioning folder mounted read-only** (`:ro`) → data source + dashboard are
  created automatically on startup, no click-setup.
- Connects directly to `db:5432` as the **read-only role `grafana_ro`** (created
  in Block 1) → it cannot write.
- Decoupled from the backend: it reads the same data the backend writes.

---

## Block 6 — Zipkin + Distributed Tracing (Observability)

The tracing backend container plus the wiring that instruments the other
containers.

**Files:** [`supabase/docker-compose.yml`](../supabase/docker-compose.yml) (service `zipkin`) + OTel envs in Blocks 3 & 4 + code ([`src/tracing.ts`](../src/tracing.ts), [`ClientAgent/agent.py`](../ClientAgent/agent.py))

- **Container** `openzipkin/zipkin`, port `9411`, in-memory storage, no auth,
  **image-internal healthcheck** (so `service_healthy` is satisfied on its own —
  no explicit healthcheck needed in Compose).
- **Cross-container wiring:** the backend and all agents receive
  `OTEL_EXPORTER_ZIPKIN_ENDPOINT: http://zipkin:9411/api/v2/spans` and their own
  `OTEL_SERVICE_NAME` → so they appear as separate services in a trace.
- **Context propagation over gRPC** (W3C `traceparent`) links the agent span and
  the backend spans into a **single** trace — verified live (a 7-span trace:
  agent → backend → 2 DB writes → SSE broadcast).

---

## Startup & Build

Build all images and start the full stack:

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml up -d --build
```

> Always use `--build` after changing backend or agent source code. Without it,
> Compose may reuse a stale image — the exact failure mode that left Zipkin empty
> until `dist/tracing.js` was rebuilt into the backend image.

See [`DOCUMENTATION.md`](DOCUMENTATION.md) for the full project documentation and
[`adr/`](adr/) for the architecture decision records behind each block.
