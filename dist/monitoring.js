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
function getInitialMetrics() {
    const metrics = db_1.db.prepare(`
    SELECT
      hostname,
      ipAddress,
      cpuUsage,
      ramUsage,
      diskUsage,
      timestamp
    FROM (
      SELECT
        servers.hostname,
        servers.ip_address AS ipAddress,
        metrics.cpu_usage AS cpuUsage,
        metrics.ram_usage AS ramUsage,
        metrics.disk_usage AS diskUsage,
        metrics.created_at AS timestamp,
        ROW_NUMBER() OVER (
          PARTITION BY servers.id
          ORDER BY metrics.created_at DESC
        ) AS rowNumber
      FROM metrics
      JOIN servers
        ON metrics.server_id = servers.id
    )
    WHERE rowNumber <= 20
    ORDER BY hostname ASC, timestamp ASC
  `).all();
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
function storeAgentMetrics(metrics) {
    const validationError = validateAgentMetrics(metrics);
    if (validationError) {
        throw new Error(validationError);
    }
    const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = metrics;
    const now = new Date().toISOString();
    db_1.db.prepare(`
    INSERT INTO servers (hostname, ip_address, last_seen)
    VALUES (?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      ip_address = excluded.ip_address,
      last_seen = excluded.last_seen
  `).run(hostname, ipAddress ?? null, now);
    const server = db_1.db
        .prepare(`SELECT id FROM servers WHERE hostname = ?`)
        .get(hostname);
    if (!server) {
        throw new Error("Failed to register server in database");
    }
    db_1.db.prepare(`
    INSERT INTO metrics (server_id, cpu_usage, ram_usage, disk_usage, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(server.id, cpuUsage, ramUsage, diskUsage, now);
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
