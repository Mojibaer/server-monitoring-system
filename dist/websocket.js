"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebSocketServer = startWebSocketServer;
exports.shutdownWebSocketServer = shutdownWebSocketServer;
const ws_1 = require("ws");
const db_1 = require("./db");
const metrics_1 = require("./metrics");
const frontendClients = new Set();
let wss;
let pingInterval;
function startWebSocketServer(port) {
    wss = new ws_1.WebSocketServer({ port });
    pingInterval = setInterval(() => {
        for (const client of wss.clients) {
            const ws = client;
            if (!ws.isAlive) {
                frontendClients.delete(ws);
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, 30000);
    wss.on("connection", (ws) => {
        ws.clientType = "unknown";
        ws.isAlive = true;
        ws.on("pong", () => {
            ws.isAlive = true;
        });
        console.log("New WebSocket client connected");
        ws.on("message", (rawData) => {
            try {
                const message = JSON.parse(rawData.toString());
                if (message.type === "frontend_register") {
                    handleFrontendRegister(ws);
                    return;
                }
                if (message.type === "agent_metrics") {
                    handleAgentMetrics(ws, message);
                    return;
                }
                sendError(ws, "Unknown message type");
            }
            catch {
                sendError(ws, "Invalid JSON message");
            }
        });
        ws.on("close", () => {
            frontendClients.delete(ws);
            console.log("WebSocket client disconnected");
        });
        ws.on("error", () => {
            frontendClients.delete(ws);
        });
    });
    wss.on("close", () => clearInterval(pingInterval));
    console.log(`WebSocket server started on ws://localhost:${port}`);
}
function shutdownWebSocketServer() {
    clearInterval(pingInterval);
    return new Promise((resolve) => {
        for (const client of wss.clients) {
            client.terminate();
        }
        wss.close(() => resolve());
    });
}
function handleFrontendRegister(ws) {
    ws.clientType = "frontend";
    frontendClients.add(ws);
    const latestMetrics = db_1.db
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
function handleAgentMetrics(ws, message) {
    const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = message.payload;
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
    db_1.db.prepare(`
    INSERT INTO servers (hostname, ip_address, last_seen)
    VALUES (?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      ip_address = excluded.ip_address,
      last_seen = excluded.last_seen
  `).run(hostname, ipAddress ?? null, now);
    const server = db_1.db
        .prepare(`SELECT id FROM servers WHERE hostname = ?`)
        .get(hostname);
    if (!server) {
        sendError(ws, "Failed to register server in database");
        return;
    }
    db_1.db.prepare(`
    INSERT INTO metrics (server_id, cpu_usage, ram_usage, disk_usage, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(server.id, cpuUsage, ramUsage, diskUsage, now);
    const status = (0, metrics_1.calculateStatus)(message.payload);
    sendJson(ws, { type: "metrics_ack", status });
    broadcastToFrontends({
        type: "metrics_update",
        payload: { hostname, ipAddress: ipAddress ?? null, cpuUsage, ramUsage, diskUsage, status, timestamp: now },
    });
    console.log(`Metrics received from ${hostname} — status: ${status}`);
}
function broadcastToFrontends(data) {
    for (const client of frontendClients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            sendJson(client, data);
        }
    }
}
function sendJson(ws, data) {
    ws.send(JSON.stringify(data));
}
function sendError(ws, message) {
    sendJson(ws, { type: "error", message });
}
