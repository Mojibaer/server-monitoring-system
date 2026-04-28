"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const websocket_1 = require("./websocket");
(0, db_1.initDatabase)();
if (process.argv.includes("--seed")) {
    (0, db_1.seedDatabase)();
    console.log("Database seeded");
}
(0, websocket_1.startWebSocketServer)(8081);
console.log("Monitoring Server Started on http://localhost:8081");
async function shutdown(signal) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    await (0, websocket_1.shutdownWebSocketServer)();
    db_1.db.close();
    console.log("Server stopped.");
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
