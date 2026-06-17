"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startSseServer = startSseServer;
exports.shutdownSseServer = shutdownSseServer;
exports.broadcastToFrontends = broadcastToFrontends;
const node_http_1 = require("node:http");
const monitoring_1 = require("./monitoring");
const frontendClients = new Set();
let httpServer;
const corsHeaders = {
    "Access-Control-Allow-Origin": "*"
};
function startSseServer(port) {
    return new Promise((resolve, reject) => {
        httpServer = (0, node_http_1.createServer)((req, res) => {
            if (req.url === "/events") {
                handleSseConnection(req, res);
                return;
            }
            res.writeHead(404, corsHeaders);
            res.end();
        });
        httpServer.once("error", (error) => {
            httpServer = undefined;
            reject(error);
        });
        httpServer.listen(port, () => {
            console.log(`SSE server started on http://localhost:${port}/events`);
            resolve();
        });
    });
}
function shutdownSseServer() {
    return new Promise((resolve) => {
        for (const client of frontendClients) {
            client.end();
        }
        frontendClients.clear();
        if (!httpServer) {
            resolve();
            return;
        }
        httpServer.close(() => {
            httpServer = undefined;
            resolve();
        });
    });
}
function handleSseConnection(req, res) {
    res.writeHead(200, {
        ...corsHeaders,
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive"
    });
    frontendClients.add(res);
    console.log(`[FRONTEND] Frontend client connected (${frontendClients.size} total)`);
    (0, monitoring_1.getInitialMetrics)()
        .then((payload) => {
        sendEvent(res, {
            type: "initial_metrics",
            payload
        });
    })
        .catch((error) => {
        const message = error instanceof Error ? error.message : "Failed to load initial metrics";
        sendEvent(res, {
            type: "error",
            payload: { message }
        });
    });
    req.on("close", () => {
        frontendClients.delete(res);
        console.log(`[DISCONNECTED] Frontend client disconnected`);
    });
}
function broadcastToFrontends(data) {
    console.log(`[BROADCAST] Sent update to ${frontendClients.size} frontend clients`);
    for (const client of frontendClients) {
        sendEvent(client, data);
    }
}
function sendEvent(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
