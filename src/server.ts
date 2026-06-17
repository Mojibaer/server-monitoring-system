import { initDatabase, seedDatabase } from "./db";
import { startSseServer, shutdownSseServer } from "./sse";
import { startGrpcServer, shutdownGrpcServer } from "./grpc";
import { waitForSupabase } from "./supabase";

async function main() {
    await waitForSupabase();
    await initDatabase();

    if (process.argv.includes("--seed")) {
        await seedDatabase();
        console.log("Supabase database seeded");
    }

    startSseServer(8081);
    startGrpcServer(50051);
    console.log("Monitoring Server Started");
}

async function shutdown(signal: string) {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    await shutdownGrpcServer();
    await shutdownSseServer();
    console.log("Server stopped.");
    process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

main().catch((error) => {
    const message = error instanceof Error ? error.message : "Failed to start monitoring server";

    console.error(message);
    process.exit(1);
});
