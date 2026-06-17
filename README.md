# Server Monitoring System

A simple real-time server monitoring project. Containerized client agents
collect basic system metrics and a backend displays them in a browser dashboard.

## What It Does

The system monitors:

- CPU usage
- RAM usage
- Disk usage
- Hostname and IP address
- Server status: `OK`, `WARNING`, `CRITICAL`, or `UNKNOWN`

Each Python agent runs in its own container, collects metrics and sends them to
a Node.js backend through gRPC. The backend stores the data in Supabase/PostgreSQL
and forwards live updates to the frontend dashboard over Server-Sent Events (SSE).

Everything (backend, agents, database) runs in Docker, started with a single
`docker compose` command.

## Architecture

```text
agent-web-01  ┐
agent-db-02   ┼─ gRPC ─→  Node backend ─ REST ─→  Supabase (db + rest + kong)
agent-edge-03 ┘             :50051                      :8000
                              │
                          SSE :8081 ─→  Browser dashboard (frontend/)
```

Each agent runs as a separate container with its own IP and its own CPU/memory
limits, so it appears in the dashboard as a distinct server. All agents are built
from one image and individualised through environment variables.

## Technologies

- **Backend:** Node.js, TypeScript, gRPC, Server-Sent Events (SSE)
- **Database:** Supabase/PostgreSQL (PostgREST + Kong) in Docker
- **Agent:** Python, grpcio, cgroup-based metrics
- **Frontend:** HTML, CSS, JavaScript
- **Orchestration:** Docker Compose

## Project Structure

```text
ClientAgent/     Python monitoring agent + Dockerfile
src/             TypeScript backend source code
Dockerfile       Backend image (multi-stage)
frontend/        Browser dashboard (runs in your browser, not in Docker)
supabase/        Dockerized Supabase stack + the full Compose file
README.md        Project overview
docs/            Detailed documentation and architecture decisions
  DOCUMENTATION.md  Detailed project documentation
  adr/              Architecture Decision Records
```

## Requirements

- Docker (Docker Desktop on Windows/macOS, Docker Engine + Compose plugin on Linux)

That is the only requirement to run the system. Node.js, npm and Python are only
needed if you want to develop or run a component outside of Docker.

## How to Run

Everything runs through Docker Compose. The Compose file lives in `supabase/`.

### 1. Create the environment file

The real secrets live in `supabase/.env`, which is gitignored. Create it once
from the template:

```bash
cp supabase/.env.example supabase/.env
```

The demo keys in the template work locally as-is. Replace them for any real
deployment.

### 2. Start the whole stack

From the project root:

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml up -d --build
```

This builds the backend and agent images (for your local architecture, so it
works on Intel and Apple Silicon alike) and starts the database, REST gateway,
backend and three agents. Startup order is handled automatically
(db → kong → backend → agents).

### 3. Check that it is running

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml ps
docker compose --env-file supabase/.env -f supabase/docker-compose.yml logs -f backend
```

The backend log should show lines like
`[AGENT:gRPC] Metrics received from web-server-01 - status: OK`.
Press `Ctrl+C` to stop watching the log (this does not stop the containers).

### 4. Open the dashboard

Open this file in your browser (it runs outside Docker and connects to
`localhost:8081`):

```text
frontend/index.html
```

You can also use the VS Code Live Server extension.

### Stop the stack

```bash
# Stop containers, keep the database data:
docker compose --env-file supabase/.env -f supabase/docker-compose.yml down

# Stop and wipe the database volume (needed for a clean schema re-init):
docker compose --env-file supabase/.env -f supabase/docker-compose.yml down -v
```

> **Schema note:** the database schema is applied once, when the data volume is
> first created. If the tables ever seem missing, run `down -v` and start again
> with a fresh volume.

## Inspecting container IPs

`docker ps` does **not** show container IPs. Each agent gets its own IP on the
Docker network — use `docker inspect` to see them:

```bash
# All agents + backend at once:
docker inspect -f '{{.Name}} -> {{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' \
  agent-web-01 agent-db-02 agent-edge-03 monitoring-backend
```

Or list every container on the network together:

```bash
docker network inspect server-monitoring_default \
  -f '{{range .Containers}}{{.Name}} -> {{.IPv4Address}}{{"\n"}}{{end}}'
```

These are internal Docker bridge IPs (e.g. `172.18.0.x`), reachable only inside
the Compose network. They are the same IPs the agents report to the backend and
that appear in the dashboard.

## Adding more agents

Each agent is its own service in `supabase/docker-compose.yml`, all built from
`ClientAgent/`. To add one, copy an existing `agent-*` block, give it a unique
`container_name`, a unique `AGENT_HOSTNAME`, and the `mem_limit` / `cpus` you
want. Because the agents read their identity and limits from the container, their
CPU and RAM figures genuinely differ per agent.

## Status Rules

The backend evaluates the server status based on the latest metric values:

- `OK`: normal usage
- `WARNING`: high usage
- `CRITICAL`: very high usage
- `UNKNOWN`: no recent data available in the dashboard

## Notes

This project is a small monitoring prototype. It uses gRPC for agent-to-backend
communication and Server-Sent Events (SSE) for browser dashboard updates. It does
not include user authentication. The Supabase stack is trimmed to the services it
actually uses (database, PostgREST, Kong).
