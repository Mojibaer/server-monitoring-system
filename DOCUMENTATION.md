# Server Monitoring System

A real-time server monitoring dashboard. Agents running on monitored machines send CPU, RAM, and disk metrics over WebSocket to a central backend, which persists them in SQLite and broadcasts live updates to a browser-based dashboard.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Backend](#backend)
  - [Entry Point](#entry-point--srcserverts)
  - [Database](#database--srcdbts)
  - [Types](#types--srctypets)
  - [Status Checks](#status-checks--srcmetricsts)
  - [WebSocket Server](#websocket-server--srcwebsocketts)
- [Frontend](#frontend)
  - [Layout](#layout--frontendindexhtml)
  - [Charts and Logic](#charts-and-logic--frontendscriptjs)
  - [Styles](#styles--frontendstylecss)
- [Client Agent](#client-agent--clientagentagentpy)
  - [Running Locally](#running-locally)
  - [Running from Another Machine](#running-from-another-machine)
- [How to Run](#how-to-run)
  - [Prerequisites](#prerequisites)
  - [Install Dependencies](#install-dependencies)
  - [Development Mode](#development-mode)
  - [Seed the Database](#seed-the-database)
  - [Build for Production](#build-for-production)
  - [Run in Production](#run-in-production)
  - [Run Tests](#run-tests)
- [Dependencies](#dependencies)
- [Team](#team)

---

## Architecture Overview

```
┌─────────────────────┐        WebSocket (ws://)        ┌──────────────────────┐
│   Client Agent      │ ──── agent_metrics ───────────► │                      │
│   (Python)          │                                  │   Backend Server     │
│   psutil metrics    │                                  │   (Node.js / TS)     │
└─────────────────────┘                                  │   Port 8081          │
                                                         │                      │
┌─────────────────────┐        WebSocket (ws://)         │   SQLite Database    │
│   Browser Dashboard │ ◄─── metrics_update ──────────── │   data/monitoring.db │
│   (HTML / JS)       │ ──── frontend_register ────────► │                      │
│   Port: file / any  │ ◄─── initial_metrics ──────────── └──────────────────────┘
└─────────────────────┘
```

- **Agents** connect to the backend and push metrics on a fixed interval (default 60 seconds).
- The **backend** validates, stores, calculates a health status, and immediately broadcasts to all connected frontends.
- The **frontend** maintains a live chart per server and detects when a server has gone silent for more than one hour.

---

## Backend

All backend source files live in `src/`. TypeScript is compiled to `dist/` via `tsc`.

### Entry Point — `src/server.ts`

Bootstraps the application in three steps:

1. Calls `initDatabase()` to create tables if they do not exist.
2. Optionally calls `seedDatabase()` when the `--seed` flag is passed.
3. Starts the WebSocket server on **port 8081**.

Registers `SIGTERM` and `SIGINT` handlers for graceful shutdown — the WebSocket server is closed and the SQLite connection is released before the process exits.

---

### Database — `src/db.ts`

Uses **better-sqlite3** (synchronous SQLite driver) with the database file at `data/monitoring.db`.

#### Schema

**`servers` table**

| Column       | Type    | Description                          |
| ------------ | ------- | ------------------------------------ |
| `id`         | INTEGER | Primary key, auto-increment          |
| `hostname`   | TEXT    | Unique server name                   |
| `ip_address` | TEXT    | Last known IP (nullable)             |
| `last_seen`  | TEXT    | ISO timestamp of last metric arrival |

**`metrics` table**

| Column       | Type    | Description                        |
| ------------ | ------- | ---------------------------------- |
| `id`         | INTEGER | Primary key, auto-increment        |
| `server_id`  | INTEGER | Foreign key → `servers.id`         |
| `cpu_usage`  | REAL    | CPU usage percentage (0–100)       |
| `ram_usage`  | REAL    | RAM usage percentage (0–100)       |
| `disk_usage` | REAL    | Disk usage percentage (0–100)      |
| `created_at` | TEXT    | ISO timestamp, defaults to `now()` |

#### Seed Data

`seedDatabase()` inserts two sample Linux servers (`linux-server-01` at `192.168.1.50` and `linux-server-02` at `192.168.1.51`) with a few sample metric rows, useful for development without a running agent.

---

### Types — `src/type.ts`

| Export                | Kind      | Description                                           |
| --------------------- | --------- | ----------------------------------------------------- |
| `ServerStatus`        | Type      | Union: `"OK" \| "WARNING" \| "CRITICAL" \| "UNKNOWN"` |
| `AgentMetricsPayload` | Interface | Shape of a metrics message sent by an agent           |
| `ClientMessage`       | Interface | Generic wrapper for any incoming WebSocket message    |

---

### Status Checks — `src/metrics.ts`

`calculateStatus(metrics: AgentMetricsPayload): ServerStatus`

Evaluates the three resource metrics and returns a single health status:

| Status     | Condition                                          |
| ---------- | -------------------------------------------------- |
| `CRITICAL` | CPU ≥ 90 % **or** RAM ≥ 90 % **or** Disk ≥ 95 %    |
| `WARNING`  | CPU ≥ 70 % **or** RAM ≥ 75 % **or** Disk ≥ 80 %    |
| `OK`       | All values below the WARNING thresholds            |
| `UNKNOWN`  | Assigned by the frontend when no data for > 1 hour |

---

### WebSocket Server — `src/websocket.ts`

Manages two types of clients: **agents** and **frontends**.

#### Connection lifecycle

1. Every new connection starts with `clientType = "unknown"`.
2. The client identifies itself by sending its first message.
3. A **30-second ping/pong keepalive** runs on all connections. Clients that miss a pong are terminated.

#### Message types (inbound)

| Type                | Sent by  | Action                                                                                                           |
| ------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `frontend_register` | Frontend | Registers as a frontend client; server replies with `initial_metrics`                                            |
| `agent_metrics`     | Agent    | Validates and stores metrics; server replies with `metrics_ack` and broadcasts `metrics_update` to all frontends |

#### Message types (outbound)

| Type              | Sent to       | Payload                                                                |
| ----------------- | ------------- | ---------------------------------------------------------------------- |
| `initial_metrics` | Frontend      | Last 20 metrics per server, ordered by hostname ASC then timestamp ASC |
| `metrics_update`  | All frontends | Latest metric for the reporting server, including calculated status    |
| `metrics_ack`     | Agent         | `{ status }` confirming receipt                                        |
| `error`           | Any client    | `{ message }` describing the problem                                   |

#### Validation (agent metrics)

All fields are validated before writing to the database:

| Field       | Rule                       |
| ----------- | -------------------------- |
| `hostname`  | Required, non-empty string |
| `cpuUsage`  | Number between 0 and 100   |
| `ramUsage`  | Number between 0 and 100   |
| `diskUsage` | Number between 0 and 100   |

Invalid messages receive an `error` response and are not stored.

---

## Frontend

Static files in `frontend/`. No build step or server required — double-clicking `index.html` opens it directly in the browser and the WebSocket connection to `ws://localhost:8081` works fine from a `file://` page in all modern browsers.

> The dashboard will only show data if the backend server is running. If the page loads but nothing appears, make sure `npm run dev` (or `npm start`) is running first.

VS Code Live Server or any other static file server also works if preferred.

### Layout — `frontend/index.html`

```
┌──────────────────────────────────────────┐
│         Server Monitoring Dashboard       │
│  [ Choose Server ▼ ]   IP: 192.168.x.x   │
├─────────────────────┬────────────────────┤
│    CPU Usage Chart  │   RAM Usage Chart  │
├─────────────────────┴────────────────────┤
│         Disk Usage: 70.3%                │
│         STATUS: OK                       │
└──────────────────────────────────────────┘
```

- **Server selector** — dropdown populated dynamically as agents connect.
- **Charts** — two canvas-based line charts (CPU and RAM).
- **Status panel** — shows current disk usage, IP address, and a colour-coded health status.

---

### Charts and Logic — `frontend/script.js`

#### Server selection persistence

The selected server is saved to `localStorage` and restored on every page load or WebSocket reconnect, so the user's choice survives browser refreshes and connection drops.

#### `LineChart` class

A custom canvas chart with no external libraries. Key methods:

| Method                           | Description                                                        |
| -------------------------------- | ------------------------------------------------------------------ |
| `setData(labels, values)`        | Replace the dataset and schedule a redraw                          |
| `setStale(stale, lastTimestamp)` | When `true`, replaces the live value label with the last-sent time |
| `scheduleDraw()`                 | Batches all redraws into `requestAnimationFrame`                   |

Features:

- Smooth bezier curves between points
- Gradient fill under the line
- Mouse-hover tooltip showing the exact value and timestamp
- Responsive — redraws automatically on window resize
- Up to **20 visible data points** (oldest are dropped as new ones arrive)

#### Date and time formatting

`formatTime(timestamp, includeDate)`:

| `includeDate` | Example output     | Used when                                 |
| ------------- | ------------------ | ----------------------------------------- |
| `false`       | `14:30:05`         | All visible data is from the same day     |
| `true`        | `12.05.2026 14:30` | Data spans multiple days, or stale labels |

The chart x-axis switches format automatically based on whether the visible data window crosses a day boundary.

#### Stale server detection

A server is considered **stale** when its most recent metric is older than **1 hour**.

The check runs:

- On every render call (`renderSelectedServer`)
- Every **60 seconds** via `setInterval`, so the status flips automatically even when no WebSocket messages arrive

When a server is stale:

| Element         | Normal display      | Stale display                                           |
| --------------- | ------------------- | ------------------------------------------------------- |
| CPU chart label | `CPU Usage: 42.3%`  | `CPU Usage: last sent 12.05.2026 14:30, nothing since`  |
| RAM chart label | `RAM Usage: 61.0%`  | `RAM Usage: last sent 12.05.2026 14:30, nothing since`  |
| Disk usage line | `Disk Usage: 70.3%` | `Disk Usage: last sent 12.05.2026 14:30, nothing since` |
| Status          | `STATUS: OK`        | `STATUS: UNKNOWN — last data: 12.05.2026 14:30`         |

Chart history lines remain fully visible. When data resumes, all labels revert to live values immediately on the next `metrics_update`.

#### Data persistence

Metrics are cached in `localStorage` under the key `server-monitoring-metrics-v1`. The last 20 data points per server are kept. On page load, cached data is shown instantly before the WebSocket delivers fresh data.

---

### Styles — `frontend/style.css`

Pure CSS, no framework. Status colours:

| Class       | Colour | Meaning                          |
| ----------- | ------ | -------------------------------- |
| `.ok`       | Green  | All metrics within normal range  |
| `.warning`  | Amber  | At least one metric elevated     |
| `.critical` | Red    | At least one metric at the limit |
| `.unknown`  | Grey   | No data received for > 1 hour    |

Fully responsive — single-column layout on screens narrower than **760 px**.

---

## Client Agent

`ClientAgent/agent.py` — a Python script that collects system metrics and streams them to the backend over WebSocket.

### How it works

1. Connects to the backend WebSocket server.
2. Every **60 seconds**:
   - Collects CPU usage (`psutil.cpu_percent(interval=1)` — blocks for 1 second for an accurate reading), RAM usage, and disk usage.
   - Sends an `agent_metrics` message with hostname, IP address, and the three metrics.
   - Waits up to 10 seconds for a `metrics_ack` response.
3. On any connection error (`ConnectionClosed`, `ConnectionRefused`, `TimeoutError`, `OSError`) it waits **5 seconds** and reconnects automatically.

### Running Locally

When the agent runs on the **same machine** as the backend, no configuration is needed:

```bash
cd ClientAgent
pip install -r requirements.txt
python agent.py
```

The agent connects to `ws://localhost:8081` by default.

### Running from Another Machine

When the agent runs on a **different machine**, edit the `BACKEND_URL` constant at the top of `agent.py`:

```python
# ClientAgent/agent.py
BACKEND_URL = "ws://192.168.1.100:8081"   # replace with your backend server's IP
```

Then run the agent as normal:

```bash
python agent.py
```

The backend accepts connections from any machine on the network as long as **port 8081** is reachable. Ensure your firewall or router allows inbound TCP connections on that port.

#### Configurable constants

| Constant           | Default               | Description                             |
| ------------------ | --------------------- | --------------------------------------- |
| `BACKEND_URL`      | `ws://localhost:8081` | WebSocket address of the backend server |
| `INTERVAL_SECONDS` | `60`                  | How often metrics are sent (in seconds) |
| `RETRY_DELAY`      | `5`                   | Seconds to wait before reconnecting     |

---

## How to Run

### Prerequisites

- **Node.js** v18 or higher
- **npm**
- **Python** 3.9 or higher (for the agent only)

### Install Dependencies

```bash
# Backend and dev tools
npm install

# Python agent
cd ClientAgent
pip install -r requirements.txt
```

### Development Mode

Runs the backend directly from TypeScript source using `tsx` — no compile step needed:

```bash
npm run dev
```

### Seed the Database

Inserts two sample servers with a few metric rows — useful for testing the frontend without a live agent:

```bash
npm run dev:seed
```

### Build for Production

Compiles TypeScript (`src/`) to JavaScript (`dist/`):

```bash
npm run build
```

### Run in Production

Requires a completed build:

```bash
npm start
```

With seed data:

```bash
npm run start:seed
```

### Run Tests

Uses the Node.js built-in test runner with `tsx` — no compile step needed:

```bash
npm test
```

The test suite (`src/websocket.test.ts`) starts a real WebSocket server on **port 8090** (isolated from the main server on 8081) and runs five integration tests:

| Test                                         | What it verifies                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `client can connect`                         | A plain WebSocket connection opens successfully                               |
| `frontend receives initial_metrics`          | Registering as a frontend triggers an `initial_metrics` response              |
| `invalid json returns error`                 | Sending garbage text returns an `error` message                               |
| `agent metrics returns ack`                  | A valid `agent_metrics` message returns a `metrics_ack`                       |
| `frontend receives metrics_update broadcast` | An agent posting metrics triggers a `metrics_update` to a registered frontend |

> **Note:** Tests use the real `data/monitoring.db` database. Test entries (`test-agent`, `broadcast-test`) will be written to it after each run.

---

## Dependencies

### Backend — `package.json`

| Package                 | Type    | Purpose                                   |
| ----------------------- | ------- | ----------------------------------------- |
| `better-sqlite3`        | Runtime | Synchronous SQLite driver                 |
| `ws`                    | Runtime | WebSocket server and client               |
| `typescript`            | Dev     | TypeScript compiler                       |
| `tsx`                   | Dev     | Run TypeScript directly without compiling |
| `@types/node`           | Dev     | Node.js type definitions                  |
| `@types/ws`             | Dev     | Type definitions for `ws`                 |
| `@types/better-sqlite3` | Dev     | Type definitions for `better-sqlite3`     |

### Frontend

No external dependencies. Uses only browser-native APIs:

| API              | Used for                            |
| ---------------- | ----------------------------------- |
| Canvas API       | Chart rendering                     |
| WebSocket API    | Real-time data from the backend     |
| localStorage API | Caching metrics and selected server |

### Python Agent — `ClientAgent/requirements.txt`

| Package      | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `websockets` | Async WebSocket client                         |
| `psutil`     | Cross-platform system metrics (CPU, RAM, disk) |

---

## Team

| Name                  | Role                              |
| --------------------- | --------------------------------- |
| **Ahmad Rafi Masir**  | Lead — Backend and Implementation |
| **Helma Arjmand**     | Frontend                          |
| **Alena Vodopianova** | WebSocket and Testing             |
| **Rifat Derman**      | Client Agent and Documentation    |
