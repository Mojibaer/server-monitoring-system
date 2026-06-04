import asyncio
import socket
import os
import psutil
import grpc
from google.protobuf import descriptor_pb2, descriptor_pool, message_factory

BACKEND_URL = "localhost:50051"
INTERVAL_SECONDS = 60
RETRY_DELAY = 5


def _field(message, name, number, field_type):
    item = message.field.add()
    item.name = name
    item.number = number
    item.label = descriptor_pb2.FieldDescriptorProto.LABEL_OPTIONAL
    item.type = field_type


def build_messages():
    file_descriptor = descriptor_pb2.FileDescriptorProto()
    file_descriptor.name = "monitoring.proto"
    file_descriptor.package = "monitoring"
    file_descriptor.syntax = "proto3"

    agent_metrics = file_descriptor.message_type.add()
    agent_metrics.name = "AgentMetrics"
    _field(agent_metrics, "hostname", 1, descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    _field(agent_metrics, "ip_address", 2, descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    _field(agent_metrics, "cpu_usage", 3, descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE)
    _field(agent_metrics, "ram_usage", 4, descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE)
    _field(agent_metrics, "disk_usage", 5, descriptor_pb2.FieldDescriptorProto.TYPE_DOUBLE)

    metrics_ack = file_descriptor.message_type.add()
    metrics_ack.name = "MetricsAck"
    _field(metrics_ack, "status", 1, descriptor_pb2.FieldDescriptorProto.TYPE_STRING)
    _field(metrics_ack, "message", 2, descriptor_pb2.FieldDescriptorProto.TYPE_STRING)

    pool = descriptor_pool.DescriptorPool()
    pool.Add(file_descriptor)

    return (
        message_factory.GetMessageClass(pool.FindMessageTypeByName("monitoring.AgentMetrics")),
        message_factory.GetMessageClass(pool.FindMessageTypeByName("monitoring.MetricsAck")),
    )


AgentMetrics, MetricsAck = build_messages()

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
    return AgentMetrics(
        hostname=socket.gethostname(),
        ip_address=get_ip_address() or "",
        cpu_usage=psutil.cpu_percent(interval=1),
        ram_usage=psutil.virtual_memory().percent,
        disk_usage=get_disk_usage(),
    )


async def connect():
    """Open the channel and return it together with the ready submit function."""
    channel = grpc.aio.insecure_channel(BACKEND_URL)
    submit_metrics = channel.unary_unary(
        "/monitoring.MonitoringService/SubmitMetrics",
        request_serializer=AgentMetrics.SerializeToString,
        response_deserializer=MetricsAck.FromString,
    )
    await channel.channel_ready()
    return channel, submit_metrics


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


async def send_loop(submit_metrics):
    """Send metrics on a fixed interval for as long as the connection holds."""
    while True:
        data = collect_metrics()
        response = await submit_metrics(data, timeout=10)
        log_metrics(data, response)
        await asyncio.sleep(INTERVAL_SECONDS)


async def run_agent():
    """Keep the connection alive and reconnect whenever it drops."""
    while True:
        try:
            print(f"[*] Connecting to {BACKEND_URL}...")
            channel, submit_metrics = await connect()
            print("[+] Connected")

            async with channel:
                await send_loop(submit_metrics)

        except (ConnectionRefusedError, OSError, grpc.RpcError, asyncio.TimeoutError) as e:
            print(f"[!] Connection lost: {e}")
            print(f"[*] Reconnecting in {RETRY_DELAY}s...")
            await asyncio.sleep(RETRY_DELAY)

        except Exception as e:
            print(f"[!!!] Unexpected error: {e}")
            await asyncio.sleep(RETRY_DELAY)


if __name__ == "__main__":
    asyncio.run(run_agent())
