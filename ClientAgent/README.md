# ClientAgent

A Python agent that collects system metrics (CPU, RAM, disk) and sends them to the monitoring server over gRPC.

## Requirements

- Python 3.8+
- The monitoring server must be running on `localhost:50051` before starting the agent

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
[*] Connecting to localhost:50051...
[+] Connected
[>] Sent metrics: {'hostname': 'my-pc', 'ip_address': '192.168.1.10', 'cpu_usage': 12.5, 'ram_usage': 60.3, 'disk_usage': 45.1}
[<] Server: Metrics received (OK)
```

The agent will send metrics every **60 seconds** and automatically reconnect if the connection drops.

## Configuration

Edit the constants at the top of `agent.py` to change the defaults:

| Variable | Default | Description |
|---|---|---|
| `BACKEND_URL` | `localhost:50051` | gRPC server address |
| `INTERVAL_SECONDS` | `60` | How often metrics are sent |
| `RETRY_DELAY` | `5` | Seconds to wait before reconnecting |

## Stop

Press `Ctrl+C` to stop the agent.
