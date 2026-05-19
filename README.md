# Server Monitoring System

A simple real-time server monitoring project. It collects basic system metrics from a computer and displays them in a browser dashboard.

## What It Does

The system monitors:

- CPU usage
- RAM usage
- Disk usage
- Hostname and IP address
- Server status: `OK`, `WARNING`, `CRITICAL`, or `UNKNOWN`

A Python agent collects the metrics and sends them to a Node.js backend through WebSocket. The backend stores the data in SQLite and forwards live updates to the frontend dashboard.

## Architecture

```text
Python Agent  →  WebSocket Backend  →  SQLite Database
                        ↓
                Browser Dashboard
```

## Technologies

- **Backend:** Node.js, TypeScript, WebSocket (`ws`)
- **Database:** SQLite
- **Agent:** Python, psutil, websockets
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
python -m venv venv
```

On Windows PowerShell:

```powershell
.\venv\Scripts\Activate.ps1
```

If script execution is blocked, run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

Then install the dependencies and start the agent:

```bash
pip install -r requirements.txt
python agent.py
```

## Status Rules

The backend evaluates the server status based on the latest metric values:

- `OK`: normal usage
- `WARNING`: high usage
- `CRITICAL`: very high usage
- `UNKNOWN`: no recent data available in the dashboard

## Notes

This project is a small monitoring prototype. It currently uses WebSocket communication and does not include user authentication or a REST API.
