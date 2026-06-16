"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAgentMetrics = validateAgentMetrics;
exports.getInitialMetrics = getInitialMetrics;
exports.storeAgentMetrics = storeAgentMetrics;
const db_1 = require("./db");
const metrics_1 = require("./metrics");
function validateAgentMetrics(metrics) {
    const { hostname, cpuUsage, ramUsage, diskUsage } = metrics;
    if (!hostname || typeof hostname !== "string") {
        return "Invalid field: hostname is required";
    }
    if (typeof cpuUsage !== "number" || cpuUsage < 0 || cpuUsage > 100) {
        return "Invalid field: cpuUsage must be a number between 0 and 100";
    }
    if (typeof ramUsage !== "number" || ramUsage < 0 || ramUsage > 100) {
        return "Invalid field: ramUsage must be a number between 0 and 100";
    }
    if (typeof diskUsage !== "number" || diskUsage < 0 || diskUsage > 100) {
        return "Invalid field: diskUsage must be a number between 0 and 100";
    }
    return null;
}
async function getInitialMetrics() {
    const rows = await (0, db_1.getMetricsWithServers)();
    const countsByServer = new Map();
    const metrics = [];
    for (const row of rows) {
        const currentCount = countsByServer.get(row.server_id) ?? 0;
        if (currentCount >= 20 || !row.servers) {
            continue;
        }
        countsByServer.set(row.server_id, currentCount + 1);
        metrics.push({
            hostname: row.servers.hostname,
            ipAddress: row.servers.ip_address,
            cpuUsage: row.cpu_usage,
            ramUsage: row.ram_usage,
            diskUsage: row.disk_usage,
            timestamp: row.created_at
        });
    }
    metrics.sort((a, b) => {
        if (a.hostname !== b.hostname) {
            return a.hostname.localeCompare(b.hostname);
        }
        return a.timestamp.localeCompare(b.timestamp);
    });
    return metrics.map((metric) => ({
        ...metric,
        status: (0, metrics_1.calculateStatus)({
            hostname: metric.hostname,
            cpuUsage: metric.cpuUsage,
            ramUsage: metric.ramUsage,
            diskUsage: metric.diskUsage
        })
    }));
}
async function storeAgentMetrics(metrics) {
    const validationError = validateAgentMetrics(metrics);
    if (validationError) {
        throw new Error(validationError);
    }
    const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = metrics;
    const now = new Date().toISOString();
    const server = await (0, db_1.upsertServer)(hostname, ipAddress ?? null, now);
    await (0, db_1.insertMetric)(server.id, cpuUsage, ramUsage, diskUsage, now);
    const status = (0, metrics_1.calculateStatus)(metrics);
    return {
        hostname,
        ipAddress: ipAddress ?? null,
        cpuUsage,
        ramUsage,
        diskUsage,
        status,
        timestamp: now
    };
}
