"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDatabase = initDatabase;
exports.seedDatabase = seedDatabase;
exports.getMetricsWithServers = getMetricsWithServers;
exports.upsertServer = upsertServer;
exports.insertMetric = insertMetric;
const node_path_1 = __importDefault(require("node:path"));
const dotenv_1 = __importDefault(require("dotenv"));
const supabase_1 = require("./supabase");
dotenv_1.default.config({ quiet: true });
dotenv_1.default.config({ path: node_path_1.default.join(process.cwd(), "supabase", ".env"), override: false, quiet: true });
const supabaseUrl = process.env.SUPABASE_PUBLIC_URL ?? "http://localhost:8000";
const configuredServiceRoleKey = process.env.SERVICE_ROLE_KEY;
if (!configuredServiceRoleKey) {
    throw new Error("SERVICE_ROLE_KEY is missing. Add it to supabase/.env or the root .env file.");
}
const serviceRoleKey = configuredServiceRoleKey;
const restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;
function headers(extra) {
    return {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
        ...extra
    };
}
async function request(resource, init) {
    const response = await fetch(`${restUrl}${resource}`, {
        ...init,
        headers: headers(init?.headers)
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Supabase request failed (${response.status}): ${body}`);
    }
    if (response.status === 204) {
        return undefined;
    }
    return response.json();
}
async function initDatabase() {
    try {
        await checkMonitoringTables();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("servers") && !message.includes("metrics")) {
            throw error;
        }
        console.log("Monitoring tables are missing. Creating Supabase schema...");
        (0, supabase_1.ensureMonitoringSchema)();
        await waitForMonitoringTables();
    }
}
async function checkMonitoringTables() {
    await request("/servers?select=id&limit=1");
    await request("/metrics?select=id&limit=1");
}
async function waitForMonitoringTables() {
    const attempts = 15;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            await checkMonitoringTables();
            return;
        }
        catch (error) {
            if (attempt === attempts) {
                throw error;
            }
            await sleep(1000);
        }
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function seedDatabase() {
    const now = new Date().toISOString();
    await deleteRows("/metrics?id=not.is.null");
    await deleteRows("/servers?id=not.is.null");
    const linuxServer1 = await upsertServer("linux-server-01", "192.168.1.50", now);
    const linuxServer2 = await upsertServer("linux-server-02", "192.168.1.51", now);
    await insertMetric(linuxServer1.id, 35.5, 62.1, 70.3);
    await insertMetric(linuxServer1.id, 42.8, 65.4, 71.0);
    await insertMetric(linuxServer2.id, 55.2, 73.6, 81.4);
}
async function getMetricsWithServers(limit = 500) {
    const query = [
        "select=id,server_id,cpu_usage,ram_usage,disk_usage,created_at,servers(hostname,ip_address)",
        "order=created_at.desc",
        `limit=${limit}`
    ].join("&");
    return request(`/metrics?${query}`);
}
async function deleteRows(resource) {
    await request(resource, {
        method: "DELETE",
        headers: {
            Prefer: "return=minimal"
        }
    });
}
async function upsertServer(hostname, ipAddress, lastSeen) {
    const rows = await request("/servers?on_conflict=hostname", {
        method: "POST",
        headers: {
            Prefer: "resolution=merge-duplicates,return=representation"
        },
        body: JSON.stringify({
            hostname,
            ip_address: ipAddress,
            last_seen: lastSeen
        })
    });
    const server = rows[0];
    if (!server) {
        throw new Error("Failed to register server in Supabase");
    }
    return server;
}
async function insertMetric(serverId, cpuUsage, ramUsage, diskUsage, createdAt = new Date().toISOString()) {
    const rows = await request("/metrics", {
        method: "POST",
        headers: {
            Prefer: "return=representation"
        },
        body: JSON.stringify({
            server_id: serverId,
            cpu_usage: cpuUsage,
            ram_usage: ramUsage,
            disk_usage: diskUsage,
            created_at: createdAt
        })
    });
    return rows[0];
}
exports.db = {
    close() {
        // Supabase REST uses short-lived HTTP requests, so there is no local connection to close.
    }
};
