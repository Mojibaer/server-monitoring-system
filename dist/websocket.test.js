"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const ws_1 = require("ws");
const websocket_1 = require("./websocket");
const db_1 = require("./db");
node_test_1.default.before(() => {
    (0, db_1.initDatabase)();
    (0, websocket_1.startWebSocketServer)(8090);
});
node_test_1.default.after(async () => {
    await (0, websocket_1.shutdownWebSocketServer)();
});
(0, node_test_1.default)("client can connect", async () => {
    await new Promise((resolve, reject) => {
        const ws = new ws_1.WebSocket("ws://localhost:8090");
        ws.on("open", () => {
            ws.close();
            resolve();
        });
        ws.on("error", reject);
    });
    strict_1.default.ok(true);
});
(0, node_test_1.default)("frontend receives initial_metrics", async () => {
    await new Promise((resolve, reject) => {
        const ws = new ws_1.WebSocket("ws://localhost:8090");
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
(0, node_test_1.default)("invalid json returns error", async () => {
    await new Promise((resolve, reject) => {
        const ws = new ws_1.WebSocket("ws://localhost:8090");
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
(0, node_test_1.default)("frontend receives metrics_update broadcast", async () => {
    await new Promise((resolve, reject) => {
        const frontend = new ws_1.WebSocket("ws://localhost:8090");
        frontend.on("open", () => {
            frontend.send(JSON.stringify({
                type: "frontend_register"
            }));
        });
        frontend.on("message", (raw) => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "initial_metrics") {
                (0, websocket_1.broadcastToFrontends)({
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
