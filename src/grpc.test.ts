import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { initDatabase } from "./db";
import { shutdownGrpcServer, startGrpcServer } from "./grpc";
import { waitForSupabase } from "./supabase";

const grpcPort = 50052;
const protoPath = path.join(process.cwd(), "proto", "monitoring.proto");

const packageDefinition = protoLoader.loadSync(protoPath, {
  defaults: true,
  enums: String,
  longs: String,
  oneofs: true
});

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const monitoringPackage = protoDescriptor.monitoring;

test.before(async () => {
  await waitForSupabase();
  await initDatabase();
  startGrpcServer(grpcPort);
});

test.after(async () => {
  await shutdownGrpcServer();
});

test("agent can submit metrics over gRPC", async () => {
  const client = new monitoringPackage.MonitoringService(
    `localhost:${grpcPort}`,
    grpc.credentials.createInsecure()
  );

  const response = await new Promise<{ status: string; message: string }>((resolve, reject) => {
    client.SubmitMetrics(
      {
        hostname: "grpc-test-agent",
        ipAddress: "127.0.0.1",
        cpuUsage: 35,
        ramUsage: 50,
        diskUsage: 60
      },
      (error: grpc.ServiceError | null, result: { status: string; message: string }) => {
        client.close();

        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      }
    );
  });

  assert.equal(response.status, "OK");
  assert.equal(response.message, "Metrics received");
});
