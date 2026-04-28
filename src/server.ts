import { db, initDatabase, seedDatabase } from "./db";
import { startWebSocketServer, shutdownWebSocketServer } from "./websocket";

initDatabase();

if (process.argv.includes("--seed")) {
    seedDatabase();
    console.log("Database seeded");
}

startWebSocketServer(8081);
console.log("Monitoring Server Started on http://localhost:8081");

async function shutdown(signal: string) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    await shutdownWebSocketServer();
    db.close();
    console.log("Server stopped.");
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
