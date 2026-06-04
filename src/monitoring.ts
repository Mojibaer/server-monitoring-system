import { db } from "./db";
import { calculateStatus } from "./metrics";
import { AgentMetricsPayload, ServerStatus } from "./type";

export interface StoredMetric extends Omit<AgentMetricsPayload, "ipAddress"> {
  ipAddress: string | null;
  status: ServerStatus;
  timestamp: string;
}

interface MetricRow {
  hostname: string;
  ipAddress: string | null;
  cpuUsage: number;
  ramUsage: number;
  diskUsage: number;
  timestamp: string;
}

export function validateAgentMetrics(metrics: AgentMetricsPayload): string | null {
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

export function getInitialMetrics() {
  const metrics = db.prepare(`
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

  return (metrics as MetricRow[]).map((metric) => ({
    ...metric,
    status: calculateStatus({
      hostname: metric.hostname,
      cpuUsage: metric.cpuUsage,
      ramUsage: metric.ramUsage,
      diskUsage: metric.diskUsage
    })
  }));
}

export function storeAgentMetrics(metrics: AgentMetricsPayload): StoredMetric {
  const validationError = validateAgentMetrics(metrics);

  if (validationError) {
    throw new Error(validationError);
  }

  const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = metrics;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO servers (hostname, ip_address, last_seen)
    VALUES (?, ?, ?)
    ON CONFLICT(hostname) DO UPDATE SET
      ip_address = excluded.ip_address,
      last_seen = excluded.last_seen
  `).run(hostname, ipAddress ?? null, now);

  const server = db
    .prepare(`SELECT id FROM servers WHERE hostname = ?`)
    .get(hostname) as { id: number } | undefined;

  if (!server) {
    throw new Error("Failed to register server in database");
  }

  db.prepare(`
    INSERT INTO metrics (server_id, cpu_usage, ram_usage, disk_usage, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(server.id, cpuUsage, ramUsage, diskUsage, now);

  const status = calculateStatus(metrics);

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
