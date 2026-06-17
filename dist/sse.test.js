"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const sse_1 = require("./sse");
const db_1 = require("./db");
const supabase_1 = require("./supabase");
const SSE_URL = "http://localhost:8090/events";
// Reads an SSE stream and resolves once a message of the wanted type arrives.
// onFirst runs after the first event, so tests can trigger a broadcast.
async function waitForEvent(type, onFirst) {
    const response = await fetch(SSE_URL);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let seenFirst = false;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) {
                throw new Error("stream closed before event arrived");
            }
            buffer += decoder.decode(value, { stream: true });
            let separator;
            while ((separator = buffer.indexOf("\n\n")) !== -1) {
                const frame = buffer.slice(0, separator);
                buffer = buffer.slice(separator + 2);
                const data = frame.replace(/^data: /, "");
                const msg = JSON.parse(data);
                if (!seenFirst) {
                    seenFirst = true;
                    onFirst?.();
                }
                if (msg.type === type) {
                    return msg;
                }
            }
        }
    }
    finally {
        await reader.cancel();
    }
}
node_test_1.default.before(async () => {
    await (0, supabase_1.ensureSupabaseRunning)();
    await (0, db_1.initDatabase)();
    await (0, sse_1.startSseServer)(8090);
});
node_test_1.default.after(async () => {
    await (0, sse_1.shutdownSseServer)();
});
(0, node_test_1.default)("client can connect", async () => {
    const response = await fetch(SSE_URL);
    strict_1.default.equal(response.status, 200);
    strict_1.default.equal(response.headers.get("content-type"), "text/event-stream");
    await response.body.cancel();
});
(0, node_test_1.default)("frontend receives initial_metrics", async () => {
    const msg = await waitForEvent("initial_metrics");
    strict_1.default.equal(msg.type, "initial_metrics");
});
(0, node_test_1.default)("frontend receives metrics_update broadcast", async () => {
    const msg = await waitForEvent("metrics_update", () => {
        (0, sse_1.broadcastToFrontends)({
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
    });
    strict_1.default.equal(msg.type, "metrics_update");
});
