import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { broadcastToFrontends, startWebSocketServer, shutdownWebSocketServer } from "./websocket";
import { initDatabase } from "./db";

test.before(() => {
  initDatabase();
  startWebSocketServer(8090);
});

test.after(async () => {
  await shutdownWebSocketServer();
});

test("client can connect", async () => {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:8090");

    ws.on("open", () => {
      ws.close();
      resolve();
    });

    ws.on("error", reject);
  });

  assert.ok(true);
});

test("frontend receives initial_metrics", async () => {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:8090");

    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "frontend_register" }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "initial_metrics") {
        ws.close();
        resolve();
      }
    });

    ws.on("error", reject);
  });
});

test("invalid json returns error", async () => {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:8090");

    ws.on("open", () => {
      ws.send("garbage");
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "error") {
        ws.close();
        resolve();
      }
    });

    ws.on("error", reject);
  });
});
test("frontend receives metrics_update broadcast", async () => {
  await new Promise<void>((resolve, reject) => {
    const frontend = new WebSocket("ws://localhost:8090");

    frontend.on("open", () => {
      frontend.send(JSON.stringify({
        type: "frontend_register"
      }));
    });

    frontend.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "initial_metrics") {
        broadcastToFrontends({
          type: "metrics_update",
          payload: {
            hostname: "broadcast-test",
            ipAddress: "192.168.1.10",
            cpuUsage: 44,
            ramUsage: 55,
            diskUsage: 66,
            status: "OK",
            timestamp: new Date().toISOString()
          }
        });
      }

      if (msg.type === "metrics_update") {
        frontend.close();
        resolve();
      }
    });

    frontend.on("error", reject);
  });
});
