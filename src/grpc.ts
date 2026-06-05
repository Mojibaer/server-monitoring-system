import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { storeAgentMetrics } from "./monitoring";
import { broadcastToFrontends } from "./sse";

interface AgentMetricsRequest {
  hostname?: string;
  ipAddress?: string;
  cpuUsage?: number;
  ramUsage?: number;
  diskUsage?: number;
}

let grpcServer: grpc.Server | undefined;

const protoPath = path.join(process.cwd(), "proto", "monitoring.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
  defaults: true,
  enums: String,
  longs: String,
  oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const monitoringPackage = protoDescriptor.monitoring;

export function startGrpcServer(port: number) {
  grpcServer = new grpc.Server();

  grpcServer.addService(monitoringPackage.MonitoringService.service, {
    SubmitMetrics: submitMetrics
  });

  grpcServer.bindAsync(
    `0.0.0.0:${port}`,
    grpc.ServerCredentials.createInsecure(),
    (error, boundPort) => {
      if (error) {
        throw error;
      }

      console.log(`gRPC server started on localhost:${boundPort}`);
    }
  );
}

export function shutdownGrpcServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!grpcServer) {
      resolve();
      return;
    }

    grpcServer.tryShutdown(() => {
      grpcServer = undefined;
      resolve();
    });
  });
}

function submitMetrics(
  call: grpc.ServerUnaryCall<AgentMetricsRequest, { status: string; message: string }>,
  callback: grpc.sendUnaryData<{ status: string; message: string }>
) {
  try {
    const storedMetric = storeAgentMetrics({
      hostname: call.request.hostname ?? "",
      ipAddress: call.request.ipAddress || undefined,
      cpuUsage: Number(call.request.cpuUsage),
      ramUsage: Number(call.request.ramUsage),
      diskUsage: Number(call.request.diskUsage)
    });

    broadcastToFrontends({
      type: "metrics_update",
      payload: storedMetric
    });

    console.log(`[AGENT:gRPC] Metrics received from ${storedMetric.hostname} - status: ${storedMetric.status}`);
    callback(null, {
      status: storedMetric.status,
      message: "Metrics received"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to process metrics";

    callback({
      code: grpc.status.INVALID_ARGUMENT,
      message
    });
  }
}
