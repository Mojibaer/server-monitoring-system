# ClientAgent

A Python agent that collects system metrics (CPU, RAM, disk) and streams them to the monitoring server over WebSocket.

## Requirements

- Python 3.8+
- The monitoring server must be running on `ws://localhost:8081` before starting the agent

## Setup

```bash
# Create and activate virtual environment
python -m venv venv
venv\Scripts\activate        # Windows
source venv/bin/activate     # Linux / macOS

# Install dependencies
pip install -r requirements.txt
```

## Run

```bash
python agent.py
```

Expected output:
```
[*] Connecting to ws://localhost:8081...
[+] Connected
[>] Sent metrics: {'hostname': 'my-pc', 'cpuUsage': 12.5, 'ramUsage': 60.3, 'diskUsage': 45.1}
[<] Server: {"type":"metrics_ack","status":"OK"}
```

The agent will send metrics every **60 seconds** and automatically reconnect if the connection drops.

## Configuration

Edit the constants at the top of `agent.py` to change the defaults:

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `ws://localhost:8081` | WebSocket server address |
| `INTERVAL_SECONDS` | `60` | How often metrics are sent |
| `RETRY_DELAY` | `5` | Seconds to wait before reconnecting |

## Stop

Press `Ctrl+C` to stop the agent.
