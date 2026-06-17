import { ensureMonitoringSchema } from "./supabase";
import { sleep } from "./utils";

const supabaseUrl = process.env.SUPABASE_PUBLIC_URL ?? "http://localhost:8000";
const configuredServiceRoleKey = process.env.SERVICE_ROLE_KEY;

if (!configuredServiceRoleKey) {
  throw new Error("SERVICE_ROLE_KEY is missing. Add it to supabase/.env or the root .env file.");
}

const serviceRoleKey: string = configuredServiceRoleKey;

export interface ServerRow {
  id: number;
  hostname: string;
  ip_address: string | null;
  last_seen: string | null;
}

export interface MetricRow {
  id: number;
  server_id: number;
  cpu_usage: number;
  ram_usage: number;
  disk_usage: number;
  created_at: string;
  servers?: {
    hostname: string;
    ip_address: string | null;
  };
}

const restUrl = `${supabaseUrl.replace(/\/$/, "")}/rest/v1`;

function headers(extra?: HeadersInit): HeadersInit {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function request<T>(resource: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${restUrl}${resource}`, {
    ...init,
    headers: headers(init?.headers)
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${body}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export async function initDatabase() {
  try {
    await checkMonitoringTables();
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (!message.includes("servers") && !message.includes("metrics")) {
      throw error;
    }

    console.log("Monitoring tables are missing. Creating Supabase schema...");
    ensureMonitoringSchema();
    await waitForMonitoringTables();
  }
}

async function checkMonitoringTables() {
  await request<ServerRow[]>("/servers?select=id&limit=1");
  await request<MetricRow[]>("/metrics?select=id&limit=1");
}

async function waitForMonitoringTables() {
  const attempts = 15;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await checkMonitoringTables();
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw error;
      }

      await sleep(1_000);
    }
  }
}

export async function seedDatabase() {
  const now = new Date().toISOString();

  await deleteRows("/metrics?id=not.is.null");
  await deleteRows("/servers?id=not.is.null");

  const linuxServer1 = await upsertServer("linux-server-01", "192.168.1.50", now);
  const linuxServer2 = await upsertServer("linux-server-02", "192.168.1.51", now);

  await insertMetric(linuxServer1.id, 35.5, 62.1, 70.3);
  await insertMetric(linuxServer1.id, 42.8, 65.4, 71.0);
  await insertMetric(linuxServer2.id, 55.2, 73.6, 81.4);
}

// 500 gives comfortable headroom for up to ~25 active servers at 20 metrics each.
export async function getMetricsWithServers(limit = 500) {
  const query = [
    "select=id,server_id,cpu_usage,ram_usage,disk_usage,created_at,servers(hostname,ip_address)",
    "order=created_at.desc",
    `limit=${limit}`
  ].join("&");

  return request<MetricRow[]>(`/metrics?${query}`);
}

async function deleteRows(resource: string) {
  await request<void>(resource, {
    method: "DELETE",
    headers: {
      Prefer: "return=minimal"
    }
  });
}

export async function upsertServer(hostname: string, ipAddress: string | null, lastSeen: string) {
  const rows = await request<ServerRow[]>("/servers?on_conflict=hostname", {
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

export async function insertMetric(
  serverId: number,
  cpuUsage: number,
  ramUsage: number,
  diskUsage: number,
  createdAt = new Date().toISOString()
) {
  const rows = await request<MetricRow[]>("/metrics", {
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

