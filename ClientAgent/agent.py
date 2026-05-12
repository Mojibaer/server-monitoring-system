import asyncio
import json
import socket
import os
import psutil
import websockets

BACKEND_URL = "ws://localhost:8081"
INTERVAL_SECONDS = 60
RETRY_DELAY = 5


def get_ip_address():
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return None


def get_disk_usage():
    path = "C:\\" if os.name == "nt" else "/"
    return psutil.disk_usage(path).percent


def collect_metrics():
    return {
        "type": "agent_metrics",
        "payload": {
            "hostname": socket.gethostname(),
            "ipAddress": get_ip_address(),
            "cpuUsage": psutil.cpu_percent(interval=1),
            "ramUsage": psutil.virtual_memory().percent,
            "diskUsage": get_disk_usage(),
        },
    }


async def run_agent():
    while True:
        try:
            print(f"[*] Connecting to {BACKEND_URL}...")

            async with websockets.connect(
                BACKEND_URL,
                ping_interval=30,
                ping_timeout=10,
            ) as ws:
                print("[+] Connected")

                while True:
                    data = collect_metrics()
                    await ws.send(json.dumps(data))
                    print("[>] Sent metrics:", data["payload"])

                    response = await asyncio.wait_for(ws.recv(), timeout=10)
                    print("[<] Server:", response)

                    await asyncio.sleep(INTERVAL_SECONDS)

        except (ConnectionRefusedError, OSError, websockets.exceptions.ConnectionClosed, asyncio.TimeoutError) as e:
            print(f"[!] Connection lost: {e}")
            print(f"[*] Reconnecting in {RETRY_DELAY}s...")
            await asyncio.sleep(RETRY_DELAY)

        except Exception as e:
            print(f"[!!!] Unexpected error: {e}")
            await asyncio.sleep(RETRY_DELAY)


if __name__ == "__main__":
    asyncio.run(run_agent())
