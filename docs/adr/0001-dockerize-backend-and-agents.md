# 0001 — Dockerize backend and client agents

- **Status:** accepted
- **Date:** 2026-06-17

## Context

The Node backend and the Python client agent were started directly on the host.
Dependencies (Node, Python, `psutil`, the Supabase stack) leaked onto each
developer's machine, and there was no clean way to run several distinct client
agents at once. We wanted:

- dependencies contained inside images, not on the host
- backend and agents in **separate** containers, communicating across IPs
- the ability to run **several** client agents from **one** image, each with its
  own identity and IP, all talking to the backend over gRPC
- the setup to work across host operating systems and CPU architectures

The backend already depended on Supabase (Postgres + PostgREST + Kong) after the
SQLite→Supabase migration. Notably, the backend started Supabase itself by
shelling out to `docker compose` — which does not work cleanly from inside a
container (it would require mounting the Docker socket).

## Decision

Run the whole system through one Docker Compose stack (in `supabase/`):

1. **Separate containers.** Backend and each agent are their own service.
   Docker's default bridge gives each container its own IP automatically; no
   `macvlan` is used (internal, non-routable IPs are sufficient).
2. **One agent image, many containers.** Three explicit `agent-*` services are
   built from the same `ClientAgent/` image and individualised via env vars
   (`AGENT_HOSTNAME`, `BACKEND_URL`) plus per-container CPU/memory limits.
   `--scale`/replicas were rejected because they cannot give each container a
   distinct identity.
3. **Real per-container metrics.** The agent reads CPU/RAM from the cgroup
   filesystem (v2 with v1 fallback) instead of host-wide `psutil`, so each agent
   reports what its own container consumes. This requires container limits to be
   meaningful. Disk usage stays pragmatic (container root filesystem).
4. **Compose owns startup, not the backend.** The backend no longer shells out to
   `docker compose`. Supabase runs as sibling services; the backend only
   *waits* for the REST API (`waitForSupabase`) and for the schema to exist.
5. **Schema via init mount.** The schema (`supabase/volumes/db/schema.sql`) is
   applied once by Postgres on a fresh data volume. The backend no longer creates
   it; the in-code schema string and the seed dump were removed.
6. **Trimmed Supabase.** Only `db`, `rest`, and `kong` run (auth, meta, studio
   removed), since the backend only uses `/rest/v1`. Dead routes were removed
   from `kong.yml`.
7. **Cross-platform via local build.** Compose uses `build:`, so every machine
   builds for its own architecture. This covers both cross-OS (Linux/macOS/
   Windows, since containers are always Linux) and cross-arch (amd64/arm64).
8. **Backend built in-image; frontend stays out.** The backend image compiles
   `src/`; the checked-in `dist/` was untracked. The browser dashboard runs on
   the host against the published SSE port `8081`.

## Consequences

- One `docker compose up` brings up db → kong → backend → agents.
- Startup robustness is layered: `depends_on: service_healthy` (ordering) **plus**
  an app-side retry loop (`waitForSupabase`) for true readiness.
- Ports: `8081` (SSE) and `8000` (Supabase) are published; `50051` (gRPC) is
  internal. An external/non-container agent requires publishing `50051`.
- **Accepted trade-offs:**
  - The init schema runs only on a fresh data volume; re-init needs `down -v`.
  - Container metrics are only meaningful with CPU/memory limits set.
  - Several agents on one host show identical figures *unless* limited (the
    cgroup approach plus limits is what makes them differ).
  - Supabase remains the heaviest part of the stack.
- Using the `SERVICE_ROLE_KEY` for all backend requests is acceptable for a local
  project but is the most privileged key and should not be spread in production.

## Notes

A Kong `401` surfaced during validation: sending both `apikey` and
`Authorization: Bearer` tripped Kong's duplicate-credential check. Fixed by
sending only the `apikey` header from the backend.
