# Server Monitoring System

A simple real-time server monitoring project. It collects basic system metrics from a computer and displays them in a browser dashboard.

## What It Does

The system monitors:

- CPU usage
- RAM usage
- Disk usage
- Hostname and IP address
- Server status: `OK`, `WARNING`, `CRITICAL`, or `UNKNOWN`

A Python agent collects the metrics and sends them to a Node.js backend through gRPC. The backend stores the data in SQLite and forwards live updates to the frontend dashboard over WebSocket.

## Architecture

```text
Python Agent  →  gRPC Backend  →  SQLite Database
                        ↓
              WebSocket Dashboard
```

## Technologies

- **Backend:** Node.js, TypeScript, gRPC, WebSocket (`ws`)
- **Database:** SQLite
- **Agent:** Python, psutil, grpcio
- **Frontend:** HTML, CSS, JavaScript

## Project Structure

```text
ClientAgent/     Python monitoring agent
src/             TypeScript backend source code
frontend/        Browser dashboard
data/            SQLite database
README.md        Project overview
DOCUMENTATION.md Detailed project documentation
```

## How to Run

### 1. Start the backend

From the main project folder:

```bash
npm install
npm run dev
```

For demo data, you can use:

```bash
npm run dev:seed
```

### 2. Open the dashboard

Open this file in your browser:

```text
frontend/index.html
```

You can also use the VS Code Live Server extension.

### 3. Start the Python agent

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

This project is a small monitoring prototype. It uses gRPC for agent-to-backend communication, WebSocket for browser dashboard updates, and does not include user authentication or a REST API.
