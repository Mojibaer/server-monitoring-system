"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db");
const sse_1 = require("./sse");
const grpc_1 = require("./grpc");
const supabase_1 = require("./supabase");
async function main() {
    await (0, supabase_1.ensureSupabaseRunning)();
    await (0, db_1.initDatabase)();
    if (process.argv.includes("--seed")) {
        await (0, db_1.seedDatabase)();
        console.log("Supabase database seeded");
    }
    await (0, sse_1.startSseServer)(8081);
    await (0, grpc_1.startGrpcServer)(50051);
    console.log("Monitoring Server Started");
}
async function shutdown(signal) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    await (0, grpc_1.shutdownGrpcServer)();
    await (0, sse_1.shutdownSseServer)();
    db_1.db.close();
    console.log("Server stopped.");
    process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
main().catch((error) => {
    const message = error instanceof Error ? error.message : "Failed to start monitoring server";
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
        console.error("Failed to start monitoring server: port 8081 or 50051 is already in use.");
        console.error("Stop the other backend process, then run the command again.");
    }
    else {
        console.error(message);
    }
    process.exit(1);
});
