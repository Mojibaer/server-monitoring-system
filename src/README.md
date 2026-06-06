# Monitoring Server — Backend

A Node.js/TypeScript backend that receives agent metrics over gRPC, stores them in SQLite, and broadcasts live updates to connected frontend clients over Server-Sent Events (SSE).

## Requirements

- Node.js 18+
- npm

## Setup

```bash
npm install
```

## Run

| Command | Description |
|---|---|
| `npm run dev` | Start the server with `tsx` (no build needed) |
| `npm run dev:seed` | Start and seed the database with sample data |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run the compiled output from `dist/` |
| `npm run start:seed` | Run compiled output and seed the database |

```bash
npm run dev
```

Expected output:
```
SSE server started on http://localhost:8081/events
gRPC server started on localhost:50051
Monitoring Server Started
```

Stop with `Ctrl+C` — the server shuts down gracefully (closes all connections and the database).

## Configuration

The dashboard SSE port is hard-coded to `8081` in `src/server.ts`. The agent gRPC port is hard-coded to `50051`.

## gRPC Protocol

The agent submits metrics through `proto/monitoring.proto`:

### Agent → Server

```proto
service MonitoringService {
  rpc SubmitMetrics (AgentMetrics) returns (MetricsAck);
}
```

The server responds with a `MetricsAck` containing the calculated status.

Status is one of: `OK`, `WARNING`, `CRITICAL`

| Metric | WARNING | CRITICAL |
|---|---|---|
| CPU | ≥ 70% | ≥ 90% |
| RAM | ≥ 75% | ≥ 90% |
| Disk | ≥ 80% | ≥ 95% |

---

## SSE Protocol

The browser dashboard connects to the SSE endpoint `http://localhost:8081/events`
with the native `EventSource` API. SSE is one-way (server → browser), so the
dashboard does not send any messages — it just listens.

### Server → Frontend

As soon as a client connects, the server sends the latest snapshot of all known servers:
```json
{
  "type": "initial_metrics",
  "payload": [
    {
      "hostname": "my-server",
      "ipAddress": "192.168.1.10",
      "cpuUsage": 45.2,
      "ramUsage": 60.1,
      "diskUsage": 70.3,
      "timestamp": "2026-04-28T10:00:00.000Z"
    }
  ]
}
```

After that, the frontend receives a live event every time any agent sends metrics:
```json
{
  "type": "metrics_update",
  "payload": {
    "hostname": "my-server",
    "ipAddress": "192.168.1.10",
    "cpuUsage": 45.2,
    "ramUsage": 60.1,
    "diskUsage": 70.3,
    "status": "OK",
    "timestamp": "2026-04-28T10:00:00.000Z"
  }
}
```

Each event is sent as one SSE frame in the form `data: <json>\n\n`. Agent-side
validation errors are reported back to the agent over gRPC (`INVALID_ARGUMENT`),
not to the dashboard.

## Database

SQLite database is stored at `data/monitoring.db` and created automatically on first run.

**Tables:**

`servers`
| Column | Type | Description |
|---|---|---|
| id | INTEGER | Primary key |
| hostname | TEXT | Unique server name |
| ip_address | TEXT | Last known IP |
| last_seen | TEXT | ISO timestamp of last metric |

`metrics`
| Column | Type | Description |
|---|---|---|
| id | INTEGER | Primary key |
| server_id | INTEGER | Foreign key → servers |
| cpu_usage | REAL | CPU % |
| ram_usage | REAL | RAM % |
| disk_usage | REAL | Disk % |
| created_at | TEXT | ISO timestamp |

## Project Structure

```
src/
├── server.ts      — entry point, startup and graceful shutdown
├── grpc.ts        — gRPC server for agent metrics
├── monitoring.ts  — metric validation, storage, and initial snapshots
├── sse.ts         — SSE server for dashboard updates
├── db.ts          — database connection, schema, seed data
├── metrics.ts     — status calculation (OK / WARNING / CRITICAL)
└── type.ts        — shared TypeScript types
```
