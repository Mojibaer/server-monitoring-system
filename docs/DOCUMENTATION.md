# Server Monitoring System Documentation

This document explains the structure, purpose, setup, and internal logic of the Server Monitoring System project.

The project is a lightweight real-time monitoring system. A Python agent runs on a monitored machine and collects CPU, RAM, and disk usage. The agent sends the data to a Node.js/TypeScript backend through gRPC. The backend stores the data in Supabase/PostgreSQL running in Docker, calculates a health status, and sends live updates to a browser dashboard through Server-Sent Events (SSE).

---

## Table of Contents

- [1. Project Goal](#1-project-goal)
- [2. System Architecture](#2-system-architecture)
- [3. Runtime Data Flow](#3-runtime-data-flow)
- [4. Backend](#4-backend)
  - [4.1 Entry Point: `src/server.ts`](#41-entry-point-srcserverts)
  - [4.2 Database: `src/db.ts`](#42-database-srcdbts)
  - [4.3 Types: `src/type.ts`](#43-types-srctypets)
  - [4.4 Status Logic: `src/metrics.ts`](#44-status-logic-srcmetricsts)
  - [4.5 Shared Monitoring Logic: `src/monitoring.ts`](#45-shared-monitoring-logic-srcmonitoringts)
  - [4.6 gRPC Server: `src/grpc.ts`](#46-grpc-server-srcgrpcts)
  - [4.7 SSE Server: `src/sse.ts`](#47-sse-server-srcssets)
- [5. Frontend](#5-frontend)
  - [5.1 Layout: `frontend/index.html`](#51-layout-frontendindexhtml)
  - [5.2 Logic and Charts: `frontend/script.js`](#52-logic-and-charts-frontendscriptjs)
  - [5.3 Styling: `frontend/style.css`](#53-styling-frontendstylecss)
- [6. Python Client Agent](#6-python-client-agent)
- [7. How to Run the Project](#7-how-to-run-the-project)
- [8. Running from Another Machine](#8-running-from-another-machine)
- [9. Tests](#9-tests)
- [10. Dependencies](#10-dependencies)
- [11. Troubleshooting](#11-troubleshooting)
- [12. Known Limitations and Possible Improvements](#12-known-limitations-and-possible-improvements)
- [13. Team Responsibilities](#13-team-responsibilities)

---

## 1. Project Goal

The goal of this project is to create a small monitoring system that can show the live resource usage of a server as well as it shows the last 20 checks, the system also store all the information in the database but historic data is not fully implemented.

The system monitors:

- CPU usage
- RAM usage
- Disk usage
- Hostname
- IP address
- Last sent check

The project is inspired by server monitoring tools such as Nagios, but it is much smaller in scope. It is designed for learning, demonstration, and classroom use.

The current implementation focuses on gRPC communication from the agent to the backend, live SSE updates from the backend to the dashboard, storing the server status in the database, agent implementation and a simple dashboard. It does not implement REST endpoints, login, authentication, or alert notifications.

---

## 2. System Architecture

```text
+---------------------------+   +---------------------------+
| Agent container (xN)       |   | Backend container          |
| Python                     |   | Node.js + TypeScript       |
| - grpcio                   |   | - @grpc/grpc-js            |
| - cgroup metrics           |   | - node:http (SSE)          |
| Own IP + CPU/mem limits    |   | - Supabase REST/PostgREST  |
+-------------+-------------+   | gRPC port: 50051           |
              |                  | SSE port:  8081            |
              | SubmitMetrics    +-------------+-------------+
              | gRPC                            |
              +-----------------> backend:50051 | stores data via REST
                                                v
                                  +-------------+-------------+
                                  | Supabase (in Docker)       |
                                  | db + rest (PostgREST)      |
                                  | + kong gateway (:8000)     |
                                  +-------------+-------------+
                                                |
                          live updates over SSE | :8081
                                                v
                                  +-------------+-------------+
                                  | Browser Dashboard          |
                                  | HTML + CSS + JavaScript    |
                                  | (runs outside Docker)      |
                                  +---------------------------+
```

All components except the browser dashboard run as Docker Compose services.
Agents are separate containers built from one image, individualised through
environment variables, each with its own IP and CPU/memory limits.

The system has three main parts:

| Part         | Technology           | Responsibility                                              |
| ------------ | -------------------- | ----------------------------------------------------------- |
| Client Agent | Python               | Collects local system metrics and sends them to the backend |
| Backend      | Node.js + TypeScript | Receives, validates, stores, and broadcasts metrics         |
| Frontend     | HTML/CSS/JavaScript  | Displays live charts and server status                      |

---

## 3. Runtime Data Flow

1. `docker compose up` starts the database, REST gateway, backend and agents. The backend waits until the Supabase REST API is reachable, then starts its gRPC and SSE servers.
2. The frontend dashboard opens `frontend/index.html` in the browser.
3. The frontend connects to the backend SSE endpoint on `http://localhost:8081/events`.
4. The backend immediately sends the latest stored metrics to the frontend as `initial_metrics`.
5. Each Python agent container connects to the gRPC server at `backend:50051` (configurable via `BACKEND_URL`).
6. Every 60 seconds, the agent collects CPU, RAM, and disk usage from the container's cgroup.
7. The agent sends these values with the gRPC `SubmitMetrics` method.
8. The backend validates the incoming values.
9. The backend creates or updates the related server record in Supabase/PostgreSQL. If it is the first metric from a hostname, the backend inserts a server row; later metrics update `ip_address` and `last_seen`.
10. The backend stores the metric row in the `metrics` table.
11. The backend calculates the current status: `OK`, `WARNING`, or `CRITICAL`.
12. The backend sends a `MetricsAck` response back to the agent.
13. The backend broadcasts a `metrics_update` event to all connected frontend clients over SSE.
14. The dashboard updates the charts and status panel.

---

## 4. Backend

The backend source files are located in the `src/` folder.

```text
src/
|-- server.ts
|-- grpc.ts
|-- monitoring.ts
|-- sse.ts
|-- db.ts
|-- metrics.ts
|-- type.ts
|-- grpc.test.ts
`-- sse.test.ts
```

The backend is written in TypeScript and can be run directly in development mode with `tsx`.

---

### 4.1 Entry Point: `src/server.ts`

This file starts the backend application.

Main responsibilities:

1. Wait until the Supabase REST API is reachable (`waitForSupabase`).
2. Wait until the monitoring tables exist (applied via the Postgres init mount).
3. Start the SSE dashboard server on port `8081`.
4. Start the gRPC agent server on port `50051`.
5. Handle graceful shutdown when the process receives `SIGINT` or `SIGTERM`.

The backend listens for agent gRPC calls on:

```text
localhost:50051
```

The backend listens for dashboard SSE connections on:

```text
http://localhost:8081/events
```

---

### 4.2 Database: `src/db.ts`

The project uses Supabase/PostgreSQL running from the `supabase/` Docker Compose stack. Data persists in the Docker volume:

```text
server-monitoring_db_data
```

The database has two main tables:

1. `servers`
2. `metrics`

#### `servers` table

| Column       | Type    | Description                             |
| ------------ | ------- | --------------------------------------- |
| `id`         | SERIAL  | Primary key, auto-increment             |
| `hostname`   | TEXT    | Unique server or computer name          |
| `ip_address` | TEXT    | Last known IP address                   |
| `last_seen`  | TIMESTAMPTZ | Timestamp of the latest received metric |

The `hostname` field is unique. If the same machine sends data again, the backend updates its IP address and `last_seen` timestamp.

#### `metrics` table

| Column       | Type    | Description                           |
| ------------ | ------- | ------------------------------------- |
| `id`         | SERIAL  | Primary key, auto-increment           |
| `server_id`  | INTEGER | Foreign key connected to `servers.id` |
| `cpu_usage`  | FLOAT   | CPU usage percentage                  |
| `ram_usage`  | FLOAT   | RAM usage percentage                  |
| `disk_usage` | FLOAT   | Disk usage percentage                 |
| `created_at` | TIMESTAMPTZ | Timestamp of the metric row       |

The relationship is:

```text
servers.id  ->  metrics.server_id
```

This means one server can have many metric rows.

#### Seed data

A seeding helper (`seedDatabase`) still exists for local development. When the
backend is run outside Docker with the `--seed` flag (`node dist/server.js --seed`),
the monitoring tables are reset and sample data is inserted, which is useful for
testing the dashboard without an agent.

In the Docker setup this is not used: the tables start empty and fill up live as
the agent containers report. The schema itself is created once from the init
mount (`supabase/volumes/db/schema.sql`), not by the backend.

---

### 4.3 Types: `src/type.ts`

This file defines shared TypeScript types.

Important types:

| Type                  | Description                                        |
| --------------------- | -------------------------------------------------- |
| `ServerStatus`        | Can be `OK`, `WARNING`, `CRITICAL`, or `UNKNOWN`   |
| `AgentMetricsPayload` | The TypeScript shape of metric data from the agent |
| `StoredMetric`        | A stored metric enriched with status and timestamp |

Example `AgentMetricsPayload`:

```typescript
{
  hostname: "DESKTOP-123",
  ipAddress: "192.168.1.100",
  cpuUsage: 25.4,
  ramUsage: 68.2,
  diskUsage: 54.6
}
```

---

### 4.4 Status Logic: `src/metrics.ts`

This file contains the `calculateStatus()` function.

The function receives CPU, RAM, and disk values and returns a server status.

| Status     | Condition                               |
| ---------- | --------------------------------------- |
| `CRITICAL` | CPU >= 90%, RAM >= 90%, or Disk >= 95%  |
| `WARNING`  | CPU >= 70%, RAM >= 75%, or Disk >= 80%  |
| `OK`       | All values are below warning thresholds |

The `UNKNOWN` status is not calculated by the backend. It is assigned by the frontend when no fresh data has been received for more than one hour.

Examples:

```text
CPU 35%, RAM 60%, Disk 55%  -> OK
CPU 72%, RAM 60%, Disk 55%  -> WARNING
CPU 91%, RAM 60%, Disk 55%  -> CRITICAL
Disk 96%                    -> CRITICAL
```

---

### 4.5 Shared Monitoring Logic: `src/monitoring.ts`

This file contains reusable backend logic shared by the gRPC server and the SSE dashboard server.

Main responsibilities:

1. Validate agent metric values.
2. Insert or update the server record in Supabase/PostgreSQL.
3. Insert each metric row in the `metrics` table.
4. Calculate the status with `calculateStatus()`.
5. Read the latest 20 metrics per server for the dashboard.

This separation keeps the data processing logic independent from the transport protocol.

#### Validation rules

| Field       | Rule                                    |
| ----------- | --------------------------------------- |
| `hostname`  | Required and must be a non-empty string |
| `cpuUsage`  | Must be a number between 0 and 100      |
| `ramUsage`  | Must be a number between 0 and 100      |
| `diskUsage` | Must be a number between 0 and 100      |

---

### 4.6 gRPC Server: `src/grpc.ts`

This file starts the backend gRPC server for the Python agent.

The gRPC contract is defined in:

```text
proto/monitoring.proto
```

The server listens on:

```text
localhost:50051
```

#### Service definition

```proto
service MonitoringService {
  rpc SubmitMetrics (AgentMetrics) returns (MetricsAck);
}
```

#### AgentMetrics message

```proto
message AgentMetrics {
  string hostname = 1;
  string ip_address = 2;
  double cpu_usage = 3;
  double ram_usage = 4;
  double disk_usage = 5;
}
```

#### MetricsAck message

```proto
message MetricsAck {
  string status = 1;
  string message = 2;
}
```

#### gRPC request handling

When the agent calls `SubmitMetrics`, the backend:

1. Converts the gRPC request into the internal metric payload shape.
2. Validates and stores the metrics through `src/monitoring.ts`.
3. Broadcasts a `metrics_update` event to connected frontend dashboards over SSE.
4. Returns `MetricsAck` with the calculated status.

Example acknowledgement:

```text
status: "OK"
message: "Metrics received"
```

If validation fails, the gRPC call returns `INVALID_ARGUMENT`.

---

### 4.7 SSE Server: `src/sse.ts`

This file manages live communication with browser dashboard clients using
Server-Sent Events (SSE). It runs a plain `node:http` server that exposes a
single streaming endpoint:

```text
GET http://localhost:8081/events
```

SSE is a one-way channel: the server pushes events to the browser, and the
browser never sends messages back. Because of that there is no client
registration step and no keepalive ping/pong — the browser's `EventSource`
reconnects automatically if the stream drops.

#### Connection handling

When a dashboard opens the `/events` endpoint, the backend:

1. Responds with the SSE headers (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`).
2. Adds the open response to the frontend client set.
3. Reads the latest 20 metrics per server from Supabase/PostgreSQL.
4. Calculates the status for each metric row.
5. Immediately sends the data as an `initial_metrics` event.

When the request closes, the connection is removed from the client set.

Each event is written to the stream as a single SSE frame:

```text
data: <json>\n\n
```

#### Initial event: `initial_metrics`

Sent automatically as soon as the dashboard connects.

```json
{
  "type": "initial_metrics",
  "payload": [
    {
      "hostname": "DESKTOP-123",
      "ipAddress": "192.168.1.100",
      "cpuUsage": 25.4,
      "ramUsage": 68.2,
      "diskUsage": 54.6,
      "timestamp": "2026-05-12T11:00:00.000Z",
      "status": "OK"
    }
  ]
}
```

##### `metrics_update`

Sent to every connected dashboard when `broadcastToFrontends()` is called by
the gRPC server after a new metric submission. The payload is a single metric
object.

```json
{
  "type": "metrics_update",
  "payload": {
    "hostname": "DESKTOP-123",
    "ipAddress": "192.168.1.100",
    "cpuUsage": 25.4,
    "ramUsage": 68.2,
    "diskUsage": 54.6,
    "status": "OK",
    "timestamp": "2026-05-12T11:00:00.000Z"
  }
}
```

Agent metrics that fail validation are rejected at the gRPC layer
(`INVALID_ARGUMENT`) and never reach the dashboard, so no error event is sent
over SSE.

---

## 5. Frontend

The frontend files are located in the `frontend/` folder.

```text
frontend/
|-- index.html
|-- script.js
`-- style.css
```

The frontend is a static dashboard. It does not need a build step.

It can be opened directly in the browser:

```text
frontend/index.html
```

It can also be served with VS Code Live Server.

---

### 5.1 Layout: `frontend/index.html`

The dashboard contains:

- Page title
- Server selection dropdown
- IP address display
- CPU usage chart
- RAM usage chart
- Disk usage display
- Status display

Conceptual layout:

```text
+--------------------------------------------------+
|             Server Monitoring Dashboard           |
| Choose Server: [ DESKTOP-123 v ]  IP: ...         |
+----------------------+---------------------------+
| CPU Usage Chart      | RAM Usage Chart           |
+----------------------+---------------------------+
| Disk Usage: 54.6%                                |
| STATUS: OK                                       |
+--------------------------------------------------+
```

---

### 5.2 Logic and Charts: `frontend/script.js`

This file contains most of the frontend behavior.

Main responsibilities:

1. Connect to the backend SSE endpoint with `EventSource`.
2. Receive `initial_metrics` and `metrics_update` events.
3. Store recent metrics per server.
4. Update the server dropdown.
5. Draw CPU and RAM charts.
6. Display disk usage and status.
7. Detect stale servers.
8. Cache recent data in `localStorage`.

#### SSE connection

The frontend connects to:

```javascript
const eventSource = new EventSource("http://localhost:8081/events");
```

If the backend runs on another computer, this address must be changed.

#### Server selection

When data is received, the frontend creates or updates an entry for that hostname.

The selected server selection is saved in `localStorage`, so after automatic refreshing (each 30 sec) the page the remain with same server selection.

#### Chart rendering

The project uses a custom `LineChart` class and the browser Canvas API. It does not use Chart.js or another chart library.

Chart features:

- Canvas-based line drawing
- CPU and RAM values over time
- Hover tooltip
- Responsive resizing
- Up to 20 visible data points per server

#### Local storage

The frontend uses these keys:

```javascript
server - monitoring - metrics - v1;
server - monitoring - selected - v1;
```

Purpose:

- Keep the latest visible metrics in the browser
- Restore the last selected server after refresh
- Show cached data immediately before fresh SSE data arrives

The main persistent storage is Supabase/PostgreSQL. The frontend cache is only a convenience feature.

#### Stale server detection

The frontend considers a server stale if the latest metric is older than one hour.

```javascript
const STALE_THRESHOLD_MS = 60 * 60 * 1000;
```

When a server is stale, the frontend shows:

```text
STATUS: UNKNOWN - last data : Ex. 12.05.2026 10:00 AM
```

This means the dashboard has not received recent data from that server.

---

### 5.3 Styling: `frontend/style.css`

The frontend uses plain CSS.

Status colors:

| Status       | Meaning    |
| ------------ | ---------- |
| Green        | `OK`       |
| Orange/Amber | `WARNING`  |
| Red          | `CRITICAL` |
| Grey         | `UNKNOWN`  |

The layout is responsive and becomes more compact on smaller screens.

---

## 6. Python Client Agent

The Python agent is located here:

```text
ClientAgent/agent.py
```

It is responsible for collecting local machine metrics and sending them to the backend.

Important constants and environment variables:

```python
BACKEND_URL    = os.environ.get("BACKEND_URL", "localhost:50051")
AGENT_HOSTNAME = os.environ.get("AGENT_HOSTNAME") or socket.gethostname()
INTERVAL_SECONDS = 60
RETRY_DELAY = 5
```

`BACKEND_URL` and `AGENT_HOSTNAME` are injected per container by Docker Compose,
so several agents built from one image report under distinct names and reach the
backend by its service name.

### Metric collection

The agent reads its own resource usage from the container's cgroup filesystem
(`cgroup_metrics.py`), not host-wide tools. This means each agent reports what
*its own container* consumes — provided the container has CPU/memory limits set.
cgroup v2 is used first, with a v1 fallback for older Docker setups.

| Metric     | Source                                                        |
| ---------- | ------------------------------------------------------------- |
| Hostname   | `AGENT_HOSTNAME` env var (falls back to `socket.gethostname()`) |
| IP address | routing-interface lookup via a dummy socket                   |
| CPU usage  | cgroup `cpu.stat` usage delta ÷ allowed cores (`cpu.max`)      |
| RAM usage  | cgroup `memory.current` ÷ `memory.max`                         |
| Disk usage | `shutil.disk_usage("/")` of the container root filesystem      |

> Because cgroup runs inside the (always-Linux) container, the agent works the
> same on Linux, macOS and Windows hosts. Container CPU/memory limits are what
> make the percentages meaningful and distinct between agents.

### Sending metrics

The agent sends metrics with a gRPC unary call to:

```text
/monitoring.MonitoringService/SubmitMetrics
```

The request matches the `AgentMetrics` message from `proto/monitoring.proto`:

```text
hostname: "DESKTOP-123"
ip_address: "192.168.1.100"
cpu_usage: 25.4
ram_usage: 68.2
disk_usage: 54.6
```

After sending, it waits for a `MetricsAck` response:

```text
status: "OK"
message: "Metrics received"
```

### Reconnection behavior

If the backend is not available or the connection is lost, the agent:

1. Prints an error message.
2. Waits 5 seconds.
3. Tries to connect again.

This makes the agent more robust during development.

---

## 7. How to Run the Project

The entire stack (database, backend and agents) runs through Docker Compose.
Only the browser dashboard runs outside Docker.

---

### 7.1 Prerequisites

The only requirement is **Docker** with the Compose plugin:

- Windows / macOS: install [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Linux: install Docker Engine and the Compose plugin (`sudo apt install docker.io docker-compose-plugin` on Debian/Ubuntu; add your user to the `docker` group with `sudo usermod -aG docker $USER`, then log out and back in)

Check it works:

```bash
docker --version
docker compose version
```

Node.js and Python are **not** required to run the system — the images build and
run everything. They are only needed for development outside the containers.

---

### 7.2 Create the environment file

The real secrets live in `supabase/.env`, which is gitignored. Create it once
from the template (the demo keys work locally as-is):

```bash
cp supabase/.env.example supabase/.env
```

---

### 7.3 Start the stack

From the project root:

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml up -d --build
```

This builds the backend and agent images for your local architecture (so it works
on Intel and Apple Silicon alike) and starts everything in the correct order
(db → kong → backend → agents).

Check status and watch the backend log:

```bash
docker compose --env-file supabase/.env -f supabase/docker-compose.yml ps
docker compose --env-file supabase/.env -f supabase/docker-compose.yml logs -f backend
```

Expected backend output:

```text
Supabase is ready
SSE server started on http://localhost:8081/events
gRPC server started on localhost:50051
Monitoring Server Started
[AGENT:gRPC] Metrics received from web-server-01 - status: OK
```

---

### 7.4 Open the frontend

Open this file in a browser (it runs outside Docker and connects to
`localhost:8081`):

```text
frontend/index.html
```

Options: double-click the file, use VS Code Live Server, or any static file server.

---

### 7.5 Stop the project

```bash
# Stop containers, keep the database data:
docker compose --env-file supabase/.env -f supabase/docker-compose.yml down

# Stop and wipe the database volume (required for a clean schema re-init):
docker compose --env-file supabase/.env -f supabase/docker-compose.yml down -v
```

> The schema is applied once, when the data volume is first created. If the
> tables ever seem missing, run `down -v` and start again.

---

## 8. Adding More Agents

Each agent is a service in `supabase/docker-compose.yml`, all built from
`ClientAgent/`. To add an agent, copy an existing `agent-*` block and give it:

- a unique `container_name`
- a unique `AGENT_HOSTNAME`
- the `mem_limit` and `cpus` you want it to report against

The agents get their IP automatically from the Docker network. Their CPU and RAM
percentages genuinely differ because each reads its own cgroup against its own
limits.

> **Exposing the backend to non-container agents:** by default the gRPC port
> `50051` is internal to the Compose network. To let an agent running outside
> Docker connect, publish the port (add `ports: ["50051:50051"]` to the backend
> service) and point that agent's `BACKEND_URL` at the host machine's IP.

---

## 9. Tests

Tests are located in:

```text
src/grpc.test.ts
src/sse.test.ts
```

Run tests with:

```bash
npm test
```

The tests start a gRPC server on port `50052` and an SSE server on port `8090`, separate from the normal application ports `50051` and `8081`.

Test coverage includes:

| Test                                       | Purpose                                |
| ------------------------------------------ | -------------------------------------- |
| Agent can submit metrics over gRPC         | Checks `SubmitMetrics` acknowledgement |
| Client can connect                         | Checks the SSE endpoint responds       |
| Frontend receives initial metrics          | Checks the `initial_metrics` event     |
| Frontend receives metrics update broadcast | Checks live broadcasting               |

Important note: the tests use the same Supabase/PostgreSQL database. Test server names such as `grpc-test-agent` and `broadcast-test` may be written into the `servers` and `metrics` tables.

---

## 10. Dependencies

### Backend dependencies

| Package                 | Type        | Purpose                                                  |
| ----------------------- | ----------- | -------------------------------------------------------- |
| `@grpc/grpc-js`         | Runtime     | gRPC server implementation for Node.js                   |
| `@grpc/proto-loader`    | Runtime     | Loads the `.proto` file at runtime                       |
| `dotenv`                | Runtime     | Loads environment variables from `supabase/.env` (Supabase URL and service role key) |
| `typescript`            | Development | TypeScript compiler                                      |
| `tsx`                   | Development | Run TypeScript directly during development               |
| `@types/node`           | Development | Node.js type definitions                                 |

The SSE server is built on the Node.js built-in `node:http` module, so no
extra WebSocket dependency is required.

### Frontend dependencies

The frontend has no external dependencies.

It uses browser-native APIs:

| API                | Purpose                                    |
| ------------------ | ------------------------------------------ |
| EventSource (SSE)  | Live connection to backend                 |
| Canvas API         | Drawing CPU and RAM charts                 |
| localStorage API   | Caching selected server and recent metrics |

### Python agent dependencies

Defined in:

```text
ClientAgent/pyproject.toml
```

| Package      | Purpose                       |
| ------------ | ----------------------------- |
| `grpcio`     | gRPC client connection        |
| `grpcio-tools` | gRPC/protobuf tooling (used to generate the `_pb2` stubs) |

CPU, RAM and disk usage are read from the container's cgroup filesystem
(`cgroup_metrics.py`), so no `psutil` dependency is needed. `protobuf` is pulled
in transitively by `grpcio` and required at runtime by the generated stubs.

---

## 11. Known Limitations and Possible Improvements

### Current limitations

- No REST API endpoints are implemented for clients.
- No login, authentication, or role-based authorization is implemented.
- No notification system is implemented.
- The frontend's SSE URL (`localhost:8081`) is hardcoded in `frontend/script.js`.
- The schema is applied only on a fresh database volume; re-initialising requires `down -v`.
- Disk usage reflects the container root filesystem, not a per-container disk quota.
- Container metrics are only meaningful when CPU/memory limits are set on the agents.
- The frontend is static and runs outside Docker; it has no build or deployment pipeline.

### Possible improvements

- Add authentication with tokens or user login.
- Add REST endpoints such as `GET /servers` and `GET /metrics`.
- Make the frontend's backend URL configurable instead of hardcoded.
- Add alert notifications for warning and critical states.
- Add process monitoring.
- Containerize the frontend (e.g. behind nginx) so the whole system runs in Docker.
- Add an idempotent schema migration step so re-init doesn't need `down -v`.
- Add better database cleanup or retention rules.
- Add more unit and integration tests.

---

## 12. Team Responsibilities

| Team member        | Responsibility                                                       |
| ------------------ | -------------------------------------------------------------------- |
| Masir Ahmad        | Backend development, database, agent implementation, Supabase integration, Dockerized Supabase stack, and lead |
| Hasan Erfani       | Real-time dashboard communication (SSE) Frontend page Implementaiton |
| Derman Rifat       | Python monitoring script and documentation Frontend design           |
| Helma Arjmand      | -                                                                    |
| Alena Vodopianova  | -                                                                    |
