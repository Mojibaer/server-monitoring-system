import { getMetricsWithServers, insertMetric, upsertServer } from "./db";
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

export async function getInitialMetrics() {
  const rows = await getMetricsWithServers();
  const countsByServer = new Map<number, number>();
  const metrics: MetricRow[] = [];

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
    status: calculateStatus({
      hostname: metric.hostname,
      cpuUsage: metric.cpuUsage,
      ramUsage: metric.ramUsage,
      diskUsage: metric.diskUsage
    })
  }));
}

export async function storeAgentMetrics(metrics: AgentMetricsPayload): Promise<StoredMetric> {
  const validationError = validateAgentMetrics(metrics);

  if (validationError) {
    throw new Error(validationError);
  }

  const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = metrics;
  const now = new Date().toISOString();

  const server = await upsertServer(hostname, ipAddress ?? null, now);
  await insertMetric(server.id, cpuUsage, ramUsage, diskUsage, now);

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
