"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startWebSocketServer = startWebSocketServer;
exports.shutdownWebSocketServer = shutdownWebSocketServer;
exports.broadcastToFrontends = broadcastToFrontends;
const ws_1 = require("ws");
const monitoring_1 = require("./monitoring");
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
        console.log(`[CONNECTED] New client connected`);
        ws.on("message", (rawData) => {
            try {
                const message = JSON.parse(rawData.toString());
                if (message.type === "frontend_register") {
                    handleFrontendRegister(ws);
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
            console.log(`[DISCONNECTED] ${ws.clientType} client disconnected`);
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
    console.log(`[FRONTEND] Frontend client registered`);
    sendJson(ws, {
        type: "initial_metrics",
        payload: (0, monitoring_1.getInitialMetrics)()
    });
}
function broadcastToFrontends(data) {
    console.log(`[BROADCAST] Sent update to ${frontendClients.size} frontend clients`);
    for (const client of frontendClients) {
        if (client.readyState === ws_1.WebSocket.OPEN) {
            sendJson(client, data);
        }
    }
}
function sendJson(ws, data) {
    if (ws.readyState === ws_1.WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}
function sendError(ws, message) {
    sendJson(ws, { type: "error", message });
}
