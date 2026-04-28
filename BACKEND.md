# Monitoring Server — Backend

A Node.js/TypeScript WebSocket server that receives metrics from agents, stores them in SQLite, and broadcasts live updates to connected frontend clients.

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
WebSocket server started on ws://localhost:8081
Monitoring Server Started on http://localhost:8081
```

Stop with `Ctrl+C` — the server shuts down gracefully (closes all connections and the database).

## Configuration

The port is hard-coded to `8081` in `src/server.ts`. Change it there if needed.

## WebSocket Protocol

All messages are JSON. Connect to `ws://localhost:8081`.

### Agent → Server

**Send metrics:**
```json
{
  "type": "agent_metrics",
  "payload": {
    "hostname": "my-server",
    "ipAddress": "192.168.1.10",
    "cpuUsage": 45.2,
    "ramUsage": 60.1,
    "diskUsage": 70.3
  }
}
```

Server responds with:
```json
{ "type": "metrics_ack", "status": "OK" }
```

Status is one of: `OK`, `WARNING`, `CRITICAL`

| Metric | WARNING | CRITICAL |
|---|---|---|
| CPU | ≥ 70% | ≥ 90% |
| RAM | ≥ 75% | ≥ 90% |
| Disk | ≥ 80% | ≥ 95% |

---

### Frontend → Server

**Register as a dashboard client:**
```json
{ "type": "frontend_register" }
```

Server immediately responds with the latest snapshot of all known servers:
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

After registering, the frontend receives a live broadcast every time any agent sends metrics:
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

### Error response

Any invalid message returns:
```json
{ "type": "error", "message": "Invalid field: ramUsage must be a number between 0 and 100" }
```

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
├── websocket.ts   — WebSocket server, message handling, ping/keepalive
├── db.ts          — database connection, schema, seed data
├── metrics.ts     — status calculation (OK / WARNING / CRITICAL)
└── type.ts        — shared TypeScript types
```
