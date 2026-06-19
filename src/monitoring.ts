import { getMetricsWithServers, insertMetric, upsertServer } from "./db";
import { calculateStatus } from "./metrics";
import { AgentMetricsPayload, ServerStatus } from "./type";
import { tracer } from "./tracing";

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

const METRICS_PER_SERVER = 20;

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
      cpuUsage: metric.cpuUsage,
      ramUsage: metric.ramUsage,
      diskUsage: metric.diskUsage
    })
  }));
}

export async function storeAgentMetrics(metrics: AgentMetricsPayload): Promise<StoredMetric> {
  return tracer.startActiveSpan("storeAgentMetrics", async (span) => {
    try {
      span.setAttribute("agent.hostname", metrics.hostname);

      const validationError = validateAgentMetrics(metrics);

      if (validationError) {
        throw new Error(validationError);
      }

      const { hostname, ipAddress, cpuUsage, ramUsage, diskUsage } = metrics;
      const now = new Date().toISOString();

      const server = await tracer.startActiveSpan("upsertServer", async (childSpan) => {
        try {
          return await upsertServer(hostname, ipAddress ?? null, now);
        } finally {
          childSpan.end();
        }
      });

      await tracer.startActiveSpan("insertMetric", async (childSpan) => {
        try {
          await insertMetric(server.id, cpuUsage, ramUsage, diskUsage, now);
        } finally {
          childSpan.end();
        }
      });

      const status = calculateStatus(metrics);
      span.setAttribute("metric.status", status);

      return {
        hostname,
        ipAddress: ipAddress ?? null,
        cpuUsage,
        ramUsage,
        diskUsage,
        status,
        timestamp: now
      };
    } finally {
      span.end();
    }
  });
}
