import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { startWebSocketServer, shutdownWebSocketServer } from "./websocket";
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
test("agent metrics returns ack", async () => {
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:8090");

    ws.on("open", () => {
      ws.send(JSON.stringify({
        type: "agent_metrics",
        payload: {
          hostname: "test-agent",
          ipAddress: "127.0.0.1",
          cpuUsage: 35,
          ramUsage: 50,
          diskUsage: 60
        }
      }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === "metrics_ack") {
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
        const agent = new WebSocket("ws://localhost:8090");

        agent.on("open", () => {
          agent.send(JSON.stringify({
            type: "agent_metrics",
            payload: {
              hostname: "broadcast-test",
              ipAddress: "192.168.1.10",
              cpuUsage: 44,
              ramUsage: 55,
              diskUsage: 66
            }
          }));
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