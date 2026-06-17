# Server Monitoring System

A simple real-time server monitoring project. It collects basic system metrics from a computer and displays them in a browser dashboard.

## What It Does

The system monitors:

- CPU usage
- RAM usage
- Disk usage
- Hostname and IP address
- Server status: `OK`, `WARNING`, `CRITICAL`, or `UNKNOWN`

A Python agent collects the metrics and sends them to a Node.js backend through gRPC. The backend stores the data in Supabase/PostgreSQL running in Docker and forwards live updates to the frontend dashboard over Server-Sent Events (SSE).

## Architecture

```text
Python Agent  →  gRPC Backend  →  Supabase/PostgreSQL
                        ↓
                SSE Dashboard
```

## Technologies

- **Backend:** Node.js, TypeScript, gRPC, Server-Sent Events (SSE)
- **Database:** Supabase/PostgreSQL in Docker
- **Agent:** Python, psutil, grpcio
- **Frontend:** HTML, CSS, JavaScript

## Project Structure

```text
ClientAgent/     Python monitoring agent
src/             TypeScript backend source code
frontend/        Browser dashboard
supabase/        Dockerized Supabase/PostgreSQL stack
README.md        Project overview
DOCUMENTATION.md Detailed project documentation
```

## Requirements

- Node.js and npm
- Docker (Docker Desktop on Windows/macOS, Docker Engine + Compose plugin on Linux)
- Python with `uv` for the client agent

## How to Run

### 1. Start Supabase/PostgreSQL

**Docker must be installed and running.** Supabase/PostgreSQL runs entirely inside Docker containers. The backend checks whether Supabase is reachable on startup and, if not, starts the Docker Compose stack automatically. Use Docker Desktop on Windows/macOS or Docker Engine + Compose plugin on Linux.

The backend checks Supabase on startup. If the Docker stack is not running, it tries to start it automatically.

You can also start it manually:

```bash
npm run supabase:up
```

Check the container status with:

```bash
npm run supabase:status
```

Supabase keeps running after the backend is stopped. Pressing `Ctrl+C` in
`npm run dev` stops only the Node.js backend, not the Docker containers.
To stop Supabase manually, run:

```bash
npm run supabase:down
```

### 2. Start the backend

From the main project folder:

```bash
npm install
npm run dev
```

For demo data, you can use:

```bash
npm run dev:seed
```

`npm run dev:seed` resets and reseeds the monitoring tables in Supabase.

### 3. Open the dashboard

Open this file in your browser:

```text
frontend/index.html
```

You can also use the VS Code Live Server extension.

### 4. Start the Python agent

Open a second terminal:

```bash
cd ClientAgent
```

Make sure [uv](https://docs.astral.sh/uv/) is installed, then install the
dependencies and start the agent:

```bash
uv sync
uv run agent.py
```

`uv` creates and manages the virtual environment automatically, so no manual
activation is required.

## Status Rules

The backend evaluates the server status based on the latest metric values:

- `OK`: normal usage
- `WARNING`: high usage
- `CRITICAL`: very high usage
- `UNKNOWN`: no recent data available in the dashboard

## Notes

This project is a small monitoring prototype. It uses gRPC for agent-to-backend communication, Server-Sent Events (SSE) for browser dashboard updates, and does not include user authentication or a REST API.
