import asyncio
import os
import socket
import time

import grpc

import monitoring_pb2
import monitoring_pb2_grpc
from cgroup_metrics import collect_resource_usage

from opentelemetry import trace
from opentelemetry.exporter.zipkin.json import ZipkinExporter
from opentelemetry.instrumentation.grpc import GrpcAioInstrumentorClient
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

BACKEND_URL = os.environ.get("BACKEND_URL", "localhost:50051")
AGENT_HOSTNAME = os.environ.get("AGENT_HOSTNAME") or socket.gethostname()
INTERVAL_SECONDS = 60
RETRY_DELAY = 5

OTEL_EXPORTER_ZIPKIN_ENDPOINT = os.environ.get(
    "OTEL_EXPORTER_ZIPKIN_ENDPOINT",
    "http://localhost:9411/api/v2/spans",
)
OTEL_SERVICE_NAME = os.environ.get("OTEL_SERVICE_NAME", AGENT_HOSTNAME)


def setup_tracing():
    provider = TracerProvider(
        resource=Resource.create({"service.name": OTEL_SERVICE_NAME})
    )
    exporter = ZipkinExporter(endpoint=OTEL_EXPORTER_ZIPKIN_ENDPOINT)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    GrpcAioInstrumentorClient().instrument()
    return trace.get_tracer("server-monitoring-agent")


tracer = setup_tracing()

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


def collect_metrics():
    cpu_usage, ram_usage, disk_usage = collect_resource_usage()
    return monitoring_pb2.AgentMetrics(
        hostname=AGENT_HOSTNAME,
        ip_address=get_ip_address() or "",
        cpu_usage=cpu_usage,
        ram_usage=ram_usage,
        disk_usage=disk_usage,
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

        with tracer.start_as_current_span("SubmitMetrics") as span:
            span.set_attribute("agent.hostname", data.hostname)
            response = await stub.SubmitMetrics(data, timeout=10)

        log_metrics(data, response)
        await asyncio.sleep(INTERVAL_SECONDS)


async def run_agent():
    """Keep the connection alive and reconnect whenever it drops."""
    while True:
        try:
            print(f"[*] Connecting to {BACKEND_URL} as {AGENT_HOSTNAME}...")
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
    try:
        asyncio.run(run_agent())
    finally:
        trace.get_tracer_provider().shutdown()
