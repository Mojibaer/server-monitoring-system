import asyncio
import socket
import os
import psutil
import grpc

import monitoring_pb2
import monitoring_pb2_grpc

BACKEND_URL = "localhost:50051"
INTERVAL_SECONDS = 60
RETRY_DELAY = 5


def get_ip_address():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))   # no real traffic, just picks the routing interface
            return s.getsockname()[0]
        finally:
            s.close()
    except Exception:
        return None


def get_disk_usage():
    path = "C:\\" if os.name == "nt" else "/"
    return psutil.disk_usage(path).percent


def collect_metrics():
    return monitoring_pb2.AgentMetrics(
        hostname=socket.gethostname(),
        ip_address=get_ip_address() or "",
        cpu_usage=psutil.cpu_percent(interval=1),
        ram_usage=psutil.virtual_memory().percent,
        disk_usage=get_disk_usage(),
    )


async def connect():
    """Open the channel and return it together with the generated service stub."""
    channel = grpc.aio.insecure_channel(BACKEND_URL)
    stub = monitoring_pb2_grpc.MonitoringServiceStub(channel)
    await channel.channel_ready()
    return channel, stub


def log_metrics(data, response):
    """Print the metrics that were sent and the server's reply."""
    print("[>] Sent metrics:", {
        "hostname": data.hostname,
        "ip_address": data.ip_address or None,
        "cpu_usage": data.cpu_usage,
        "ram_usage": data.ram_usage,
        "disk_usage": data.disk_usage,
    })
    print(f"[<] Server: {response.message} ({response.status})")


async def send_loop(stub):
    """Send metrics on a fixed interval for as long as the connection holds."""
    while True:
        data = collect_metrics()
        response = await stub.SubmitMetrics(data, timeout=10)
        log_metrics(data, response)
        await asyncio.sleep(INTERVAL_SECONDS)


async def run_agent():
    """Keep the connection alive and reconnect whenever it drops."""
    while True:
        try:
            print(f"[*] Connecting to {BACKEND_URL}...")
            channel, stub = await connect()
            print("[+] Connected")

            async with channel:
                await send_loop(stub)

        except (ConnectionRefusedError, OSError, grpc.RpcError, asyncio.TimeoutError) as e:
            print(f"[!] Connection lost: {e}")
            print(f"[*] Reconnecting in {RETRY_DELAY}s...")
            await asyncio.sleep(RETRY_DELAY)

        except Exception as e:
            print(f"[!!!] Unexpected error: {e}")
            await asyncio.sleep(RETRY_DELAY)


if __name__ == "__main__":
    asyncio.run(run_agent())
