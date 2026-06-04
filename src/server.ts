import { db, initDatabase, seedDatabase } from "./db";
import { startWebSocketServer, shutdownWebSocketServer } from "./websocket";
import { startGrpcServer, shutdownGrpcServer } from "./grpc";

initDatabase();

if (process.argv.includes("--seed")) {
    seedDatabase();
    console.log("Database seeded");
}

startWebSocketServer(8081);
startGrpcServer(50051);
console.log("Monitoring Server Started");

async function shutdown(signal: string) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    await shutdownGrpcServer();
    await shutdownWebSocketServer();
    db.close();
    console.log("Server stopped.");
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
