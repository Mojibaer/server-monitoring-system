# ── Build stage: install runtime deps into a clean prefix ────────────
FROM python:3.13-slim AS build

# grpcio + protobuf ship prebuilt manylinux (glibc) wheels — no compiler on slim.
# protobuf is required at runtime by the generated monitoring_pb2 modules.
RUN pip install --no-cache-dir --prefix=/install "grpcio>=1.81.0" "protobuf>=5.0.0"

# ── Runtime stage ────────────────────────────────────────────────────
FROM python:3.13-slim AS runtime

ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY --from=build /install /usr/local

COPY agent.py cgroup_metrics.py monitoring_pb2.py monitoring_pb2_grpc.py ./

CMD ["python", "agent.py"]
