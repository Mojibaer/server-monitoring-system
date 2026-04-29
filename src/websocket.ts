import { WebSocketServer, WebSocket } from "ws";
import { db } from "./db";
import { calculateStatus } from "./metrics";
import { AgentMetricsPayload } from "./type";

type ClientType = "agent" | "frontend" | "unknown";

interface ExtendedWebSocket extends WebSocket {
  clientType: ClientType;
  isAlive: boolean;
}

interface AgentMetricsMessage {
  type: "agent_metrics";
  payload: AgentMetricsPayload;
}

interface RegisterFrontendMessage {
  type: "frontend_register";
}

type ClientMessage = AgentMetricsMessage | RegisterFrontendMessage;

const frontendClients = new Set<ExtendedWebSocket>();
let wss: WebSocketServer;
let pingInterval: ReturnType<typeof setInterval>;

export function startWebSocketServer(port: number) {
  wss = new WebSocketServer({ port });

  pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as ExtendedWebSocket;
      if (!ws.isAlive) {
        frontendClients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on("connection", (ws: ExtendedWebSocket) => {
    ws.clientType = "unknown";
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    console.log(`[CONNECTED] New client connected`);

    ws.on("message", (rawData) => {
      try {
        const message = JSON.parse(rawData.toString()) as ClientMessage;

        if (message.type === "frontend_register") {
          handleFrontendRegister(ws);
          return;
        }

        if (message.type === "agent_metrics") {
          handleAgentMetrics(ws, message);
          return;
        }

        sendError(ws, "Unknown message type");
      } catch {
        sendError(ws, "Invalid JSON message");
      }
    });

    ws.on("close", () => {
      frontendClients.delete(ws);
      console.log(`[DISCONNECTED] ${ws.clientType} client disconnected`);
    });

    ws.on("error", () => {
      frontendClients.delete(ws);
    });
  });

  wss.on("close", () => clearInterval(pingInterval));

  console.log(`WebSocket server started on ws://localhost:${port}`);
}

export function shutdownWebSocketServer(): Promise<void> {
  clearInterval(pingInterval);
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => resolve());
  });
}

function handleFrontendRegister(ws: ExtendedWebSocket) {
  ws.clientType = "frontend";
  frontendClients.add(ws);
  console.log(`[FRONTEND] Frontend client registered`);
  const latestMetrics = db
    .prepare(`
      SELECT
        servers.hostname,
        servers.ip_address AS ipAddress,
        metrics.cpu_usage AS cpuUsage,
        metrics.ram_usage AS ramUsage,
        metrics.disk_usage AS diskUsage,
        metrics.created_at AS timestamp
      FROM metrics
      JOIN servers ON metrics.server_id = servers.id
      WHERE metrics.id IN (
        SELECT MAX(id)
        FROM metrics
        GROUP BY server_id
      )
      ORDER BY metrics.created_at DESC
    `)
    .all();

  sendJson(ws, { type: "initial_metrics", payload: latestMetrics });
}

function handleAgentMetrics(ws: ExtendedWebSocket, message: AgentMetricsMessage) {
  const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = message.payload;

  ws.clientType = "agent";

  if (!hostname || typeof hostname !== "string") {
    sendError(ws, "Invalid field: hostname is required");
    return;
  }
  if (typeof cpuUsage !== "number" || cpuUsage < 0 || cpuUsage > 100) {
    sendError(ws, "Invalid field: cpuUsage must be a number between 0 and 100");
    return;
  }
  if (typeof ramUsage !== "number" || ramUsage < 0 || ramUsage > 100) {
    sendError(ws, "Invalid field: ramUsage must be a number between 0 and 100");
    return;
  }
  if (typeof diskUsage !== "number" || diskUsage < 0 || diskUsage > 100) {
    sendError(ws, "Invalid field: diskUsage must be a number between 0 and 100");
    return;
  }

  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO servers (hostname, ip_address, last_seen)
    VALUES (?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      ip_address = excluded.ip_address,
      last_seen = excluded.last_seen
  `).run(hostname, ipAddress ?? null, now);

  const server = db
    .prepare(`SELECT id FROM servers WHERE hostname = ?`)
    .get(hostname) as { id: number } | undefined;

  if (!server) {
    sendError(ws, "Failed to register server in database");
    return;
  }

  db.prepare(`
    INSERT INTO metrics (server_id, cpu_usage, ram_usage, disk_usage, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(server.id, cpuUsage, ramUsage, diskUsage, now);

  const status = calculateStatus(message.payload);

  sendJson(ws, { type: "metrics_ack", status });

  broadcastToFrontends({

    type: "metrics_update",
    payload: { hostname, ipAddress: ipAddress ?? null, cpuUsage, ramUsage, diskUsage, status, timestamp: now },
  });

  console.log(`[AGENT] Metrics received from ${hostname} — status: ${status}`);
}

function broadcastToFrontends(data: object) {
  console.log(`[BROADCAST] Sent update to ${frontendClients.size} frontend clients`);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      sendJson(client, data);
    }
  }
}

function sendJson(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws: WebSocket, message: string) {
  sendJson(ws, { type: "error", message });
}
