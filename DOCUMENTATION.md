# Server Monitoring System Documentation

This document explains the structure, purpose, setup, and internal logic of the Server Monitoring System project.

The project is a lightweight real-time monitoring system. A Python agent runs on a monitored machine and collects CPU, RAM, and disk usage. The agent sends the data to a Node.js/TypeScript backend through gRPC. The backend stores the data in SQLite, calculates a health status, and sends live updates to a browser dashboard through WebSocket.

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
  - [4.7 WebSocket Server: `src/websocket.ts`](#47-websocket-server-srcwebsocketts)
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

The current implementation focuses on gRPC communication from the agent to the backend, live WebSocket updates from the backend to the dashboard, storing the server status in the database, agent implementation and a simple dashboard. It does not implement REST endpoints, login, authentication, or alert notifications.

---

## 2. System Architecture

```text
+---------------------------+
| Monitored Machine          |
| Python Agent               |
| - psutil                   |
| - grpcio                   |
+-------------+-------------+
              |
              | SubmitMetrics
              | gRPC
              v
+-------------+-------------+
| Backend Server             |
| Node.js + TypeScript       |
| - @grpc/grpc-js            |
| - ws                       |
| - better-sqlite3           |
| gRPC port: 50051           |
| WebSocket port: 8081       |
+-------------+-------------+
              |
              | stores data
              v
+-------------+-------------+
| SQLite Database            |
| data/monitoring.db         |
+-------------+-------------+
              |
              | live updates over WebSocket
              v
+-------------+-------------+
| Browser Dashboard          |
| HTML + CSS + JavaScript    |
| Canvas charts              |
+---------------------------+
```

The system has three main parts:

| Part         | Technology           | Responsibility                                              |
| ------------ | -------------------- | ----------------------------------------------------------- |
| Client Agent | Python               | Collects local system metrics and sends them to the backend |
| Backend      | Node.js + TypeScript | Receives, validates, stores, and broadcasts metrics         |
| Frontend     | HTML/CSS/JavaScript  | Displays live charts and server status                      |

---

## 3. Runtime Data Flow

1. The backend is started with `npm run build` and then `npm run start` or directly `npm run dev` but not recommended for the production. If there is no db to seed / populate db, the program must be started as following `npm run build` then `npm run dev:seed` and at last `npm run start`
2. The frontend dashboard opens `frontend/index.html` in the browser.
3. The frontend connects to the backend with WebSocket on `ws://localhost:8081` and sends `frontend_register`.
4. The backend sends the latest stored metrics to the frontend as `initial_metrics`.
5. The Python agent starts and connects to the gRPC server on `localhost:50051`.
6. Every 60 seconds, the agent collects CPU, RAM, and disk usage.
7. The agent sends these values with the gRPC `SubmitMetrics` method.
8. The backend validates the incoming values.
9. The backend creates or updates the related server record in SQLite (if it is first time it adds the entry for the server based on the hostname after that it update the last_seen db column ).
10. The backend stores the metric row in the `metrics` table.
11. The backend calculates the current status: `OK`, `WARNING`, or `CRITICAL`.
12. The backend sends a `MetricsAck` response back to the agent.
13. The backend broadcasts a `metrics_update` message to all connected frontend clients.
14. The dashboard updates the charts and status panel.

---

## 4. Backend

The backend source files are located in the `src/` folder.

```text
src/
|-- server.ts
|-- grpc.ts
|-- monitoring.ts
|-- websocket.ts
|-- db.ts
|-- metrics.ts
|-- type.ts
|-- grpc.test.ts
`-- websocket.test.ts
```

The backend is written in TypeScript and can be run directly in development mode with `tsx`.

---

### 4.1 Entry Point: `src/server.ts`

This file starts the backend application.

Main responsibilities:

1. Initialize the SQLite database.
2. Optionally seed the database with sample data.
3. Start the WebSocket dashboard server on port `8081`.
4. Start the gRPC agent server on port `50051`.
5. Handle graceful shutdown when the process receives `SIGINT` or `SIGTERM`.

The backend listens for agent gRPC calls on:

```text
localhost:50051
```

The backend listens for dashboard WebSocket connections on:

```text
ws://localhost:8081
```

---

### 4.2 Database: `src/db.ts`

The project uses `better-sqlite3` and stores data in this file:

```text
data/monitoring.db
```

The database has two main tables:

1. `servers`
2. `metrics`

#### `servers` table

| Column       | Type    | Description                             |
| ------------ | ------- | --------------------------------------- |
| `id`         | INTEGER | Primary key, auto-increment             |
| `hostname`   | TEXT    | Unique server or computer name          |
| `ip_address` | TEXT    | Last known IP address                   |
| `last_seen`  | TEXT    | Timestamp of the latest received metric |

The `hostname` field is unique. If the same machine sends data again, the backend updates its IP address and `last_seen` timestamp.

#### `metrics` table

| Column       | Type    | Description                           |
| ------------ | ------- | ------------------------------------- |
| `id`         | INTEGER | Primary key, auto-increment           |
| `server_id`  | INTEGER | Foreign key connected to `servers.id` |
| `cpu_usage`  | REAL    | CPU usage percentage                  |
| `ram_usage`  | REAL    | RAM usage percentage                  |
| `disk_usage` | REAL    | Disk usage percentage                 |
| `created_at` | TEXT    | Timestamp of the metric row           |

The relationship is:

```text
servers.id  ->  metrics.server_id
```

This means one server can have many metric rows.

#### Seed data

When the backend is started with this command:

```bash
npm run dev:seed
```

sample data is inserted into the database. This is useful for testing the dashboard without starting the Python agent.

---

### 4.3 Types: `src/type.ts`

This file defines shared TypeScript types.

Important types:

| Type                  | Description                                       |
| --------------------- | ------------------------------------------------- |
| `ServerStatus`        | Can be `OK`, `WARNING`, `CRITICAL`, or `UNKNOWN`  |
| `AgentMetricsPayload` | The TypeScript shape of metric data from the agent |
| `ClientMessage`       | A generic incoming WebSocket dashboard message structure |

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

This file contains reusable backend logic shared by the gRPC server and the WebSocket dashboard server.

Main responsibilities:

1. Validate agent metric values.
2. Insert or update the server record in SQLite.
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
3. Broadcasts a `metrics_update` message to connected frontend dashboards.
4. Returns `MetricsAck` with the calculated status.

Example acknowledgement:

```text
status: "OK"
message: "Metrics received"
```

If validation fails, the gRPC call returns `INVALID_ARGUMENT`.

---

### 4.7 WebSocket Server: `src/websocket.ts`

This file manages live communication with browser dashboard clients.

It manages frontend clients:

| Client type | Description                                |
| ----------- | ------------------------------------------ |
| `frontend`  | A browser dashboard receiving live updates |

Every new connection starts as `unknown`. A `frontend_register` message identifies the client as a dashboard.

#### Keepalive behavior

The WebSocket server uses a ping/pong check every 30 seconds.

If a client does not respond, it is removed and the connection is terminated. This prevents dead connections from staying in memory.

#### Incoming message: `frontend_register`

Sent by the dashboard when it opens.

```json
{
  "type": "frontend_register"
}
```

Backend behavior:

1. Marks the connection as a frontend client.
2. Adds the connection to the frontend client set.
3. Reads the latest 20 metrics per server from SQLite.
4. Calculates the status for each metric row.
5. Sends the data back as `initial_metrics`.

Example response:

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

#### Broadcast message: `metrics_update`

When the gRPC server receives and stores new agent metrics, it calls `broadcastToFrontends()` in `src/websocket.ts`. Registered dashboards receive:

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

Invalid messages receive an error response and are not stored.

Example error:

```json
{
  "type": "error",
  "message": "Invalid field: cpuUsage must be a number between 0 and 100"
}
```

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

1. Connect to the backend with WebSocket.
2. Register the dashboard with `frontend_register`.
3. Receive `initial_metrics` and `metrics_update` messages.
4. Store recent metrics per server.
5. Update the server dropdown.
6. Draw CPU and RAM charts.
7. Display disk usage and status.
8. Detect stale servers.
9. Cache recent data in `localStorage`.

#### WebSocket connection

The frontend connects to:

```javascript
const socket = new WebSocket("ws://localhost:8081");
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
- Show cached data immediately before fresh WebSocket data arrives

The main persistent storage is still SQLite. The frontend cache is only a convenience feature.

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

Important constants:

```python
BACKEND_URL = "localhost:50051"
INTERVAL_SECONDS = 60
RETRY_DELAY = 5
```

### Metric collection

The agent uses `psutil`.

| Metric     | Code                                         |
| ---------- | -------------------------------------------- |
| Hostname   | `socket.gethostname()`                       |
| IP address | `socket.gethostbyname(socket.gethostname())` |
| CPU usage  | `psutil.cpu_percent(interval=1)`             |
| RAM usage  | `psutil.virtual_memory().percent`            |
| Disk usage | `psutil.disk_usage(path).percent`            |

For disk usage, the script checks:

- `C:\` on Windows
- `/` on Linux/macOS

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

The correct order is important:

```text
1. Start backend
2. Open frontend dashboard
3. Start Python agent
```

---

### 7.1 Prerequisites

Install these first:

- Node.js 18 or newer
- npm
- Python 3.9 or newer
- VS Code is optional but recommended

Check versions:

```bash
node -v
npm -v
python --version
```

On Windows, if `python` does not work, try:

```bash
py --version
```

---

### 7.2 Start the backend

Open a terminal in the main project folder, where `package.json` exists.

Install dependencies:

```bash
npm install
```

Run backend in development mode:

```bash
npm run dev
```

Or run with sample data:

```bash
npm run dev:seed
```

Expected output:

```text
WebSocket server started on ws://localhost:8081
gRPC server started on localhost:50051
Monitoring Server Started
```

The important addresses are:

```text
Agent gRPC: localhost:50051
Dashboard WebSocket: ws://localhost:8081
```

Keep this terminal open.

---

### 7.3 Open the frontend

Open this file in a browser:

```text
frontend/index.html
```

Options:

- Double-click the file
- Use VS Code Live Server
- Use any simple static file server

The dashboard will connect to the backend through WebSocket.

---

### 7.4 Start the Python agent on Windows PowerShell

Open a second terminal.

Go into the agent folder:

```powershell
cd ClientAgent
```

Create a virtual environment:

```powershell
python -m venv venv
```

Activate it:

```powershell
.\venv\Scripts\Activate.ps1
```

If PowerShell shows this error:

```text
running scripts is disabled on this system
```

run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Then activate again:

```powershell
.\venv\Scripts\Activate.ps1
```

When activation works, the terminal usually starts with:

```text
(venv)
```

Install dependencies:

```powershell
pip install -r requirements.txt
```

Run the agent:

```powershell
python agent.py
```

Expected output:

```text
[*] Connecting to localhost:50051...
[+] Connected
[>] Sent metrics: {'hostname': 'DESKTOP-123', ...}
[<] Server: Metrics received (OK)
```

---

### 7.5 Start the Python agent on Linux/macOS

```bash
cd ClientAgent
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python3 agent.py
```

---

### 7.6 Stop the project

To stop the backend or agent, go to the related terminal and press:

```text
Ctrl + C
```

---

## 8. Running from Another Machine

By default, both frontend and agent use:

```text
Agent: localhost:50051
Frontend: ws://localhost:8081
```

This works only when everything runs on the same machine.

If the backend runs on another computer, update the gRPC agent address and the frontend WebSocket address.

### Update the Python agent

In `ClientAgent/agent.py`:

```python
BACKEND_URL = "192.168.1.100:50051"
```

Replace `192.168.1.100` with the backend machine's IP address.

### Update the frontend

In `frontend/script.js`, change:

```javascript
const socket = new WebSocket("ws://localhost:8081");
```

to something like:

```javascript
const socket = new WebSocket("ws://192.168.1.100:8081");
```

### Firewall

The backend machine must allow incoming TCP connections on port `50051` for the agent and port `8081` for the dashboard.

---

## 9. Tests

Tests are located in:

```text
src/grpc.test.ts
src/websocket.test.ts
```

Run tests with:

```bash
npm test
```

The tests start a gRPC server on port `50052` and a WebSocket server on port `8090`, separate from the normal application ports `50051` and `8081`.

Test coverage includes:

| Test                                       | Purpose                                |
| ------------------------------------------ | -------------------------------------- |
| Agent can submit metrics over gRPC         | Checks `SubmitMetrics` acknowledgement |
| Client can connect                         | Checks basic WebSocket connection      |
| Frontend receives initial metrics          | Checks `frontend_register` behavior    |
| Invalid JSON returns error                 | Checks error handling                  |
| Frontend receives metrics update broadcast | Checks live broadcasting               |

Important note: the tests use the same SQLite database file. Test server names such as `grpc-test-agent` and `broadcast-test` may be written into `data/monitoring.db`.

---

## 10. Dependencies

### Backend dependencies

| Package                 | Type        | Purpose                                                  |
| ----------------------- | ----------- | -------------------------------------------------------- |
| `@grpc/grpc-js`         | Runtime     | gRPC server implementation for Node.js                   |
| `@grpc/proto-loader`    | Runtime     | Loads the `.proto` file at runtime                       |
| `better-sqlite3`        | Runtime     | SQLite database access                                   |
| `ws`                    | Runtime     | WebSocket server and client                              |
| `dotenv`                | Runtime     | Listed dependency; not actively used in the current code |
| `typescript`            | Development | TypeScript compiler                                      |
| `tsx`                   | Development | Run TypeScript directly during development               |
| `@types/node`           | Development | Node.js type definitions                                 |
| `@types/ws`             | Development | Type definitions for `ws`                                |
| `@types/better-sqlite3` | Development | Type definitions for `better-sqlite3`                    |

### Frontend dependencies

The frontend has no external dependencies.

It uses browser-native APIs:

| API              | Purpose                                    |
| ---------------- | ------------------------------------------ |
| WebSocket API    | Live connection to backend                 |
| Canvas API       | Drawing CPU and RAM charts                 |
| localStorage API | Caching selected server and recent metrics |

### Python agent dependencies

Defined in:

```text
ClientAgent/requirements.txt
```

| Package      | Purpose                       |
| ------------ | ----------------------------- |
| `psutil`     | Read CPU, RAM, and disk usage |
| `grpcio`     | gRPC client connection        |
| `grpcio-tools` | gRPC/protobuf tooling       |

---

## 11. Known Limitations and Possible Improvements

### Current limitations

- No REST API endpoints are implemented.
- No login, authentication, or role-based authorization is implemented.
- No notification system is implemented.
- The gRPC agent address and WebSocket dashboard URL are hardcoded.
- SQLite is used as a local database and is not intended for large-scale production monitoring.
- The frontend is static and does not have a build or deployment pipeline.
- The backend does not provide a separate HTTP API for historical data queries.

### Possible improvements

- Add authentication with tokens or user login.
- Add REST endpoints such as `GET /servers` and `GET /metrics`.
- Move configuration to `.env` files.
- Add alert notifications for warning and critical states.
- Add process monitoring.
- Add Docker support.
- Add better database cleanup or retention rules.
- Add more unit and integration tests.
- Add a configuration screen for backend URL and refresh interval.

---

## 12. Team Responsibilities

| Team member       | Responsibility                                             |
| ----------------- | ---------------------------------------------------------- |
| Masir Ahmad       | Backend development database agent implementation and lead |
| Vodopianova Alena | WebSocket communication                                    |
| Arjmand Helma     | Frontend page                                              |
| Derman Rifat      | Python monitoring script and documentation                 |
