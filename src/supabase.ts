import { spawnSync } from "node:child_process";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ quiet: true });
dotenv.config({ path: path.join(process.cwd(), "supabase", ".env"), override: false, quiet: true });

const supabaseDir = path.join(process.cwd(), "supabase");
const supabaseUrl = (process.env.SUPABASE_PUBLIC_URL ?? "http://localhost:8000").replace(/\/$/, "");
const configuredServiceRoleKey = process.env.SERVICE_ROLE_KEY;

if (!configuredServiceRoleKey) {
  throw new Error("SERVICE_ROLE_KEY is missing. Add it to supabase/.env or the root .env file.");
}

const serviceRoleKey: string = configuredServiceRoleKey;
const schemaSql = `
CREATE TABLE IF NOT EXISTS public.servers (
    id          SERIAL PRIMARY KEY,
    hostname    TEXT NOT NULL UNIQUE,
    ip_address  TEXT,
    last_seen   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.metrics (
    id          SERIAL PRIMARY KEY,
    server_id   INTEGER NOT NULL REFERENCES public.servers(id) ON DELETE CASCADE,
    cpu_usage   FLOAT NOT NULL,
    ram_usage   FLOAT NOT NULL,
    disk_usage  FLOAT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_server_created
    ON public.metrics (server_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_metrics_created_at
    ON public.metrics (created_at DESC);

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON public.servers TO anon, authenticated, service_role;
GRANT ALL ON public.metrics TO anon, authenticated, service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
`;

export async function ensureSupabaseRunning() {
  if (await isSupabaseApiReady()) {
    console.log("Supabase is already running");
    return;
  }

  console.log("Supabase is not reachable. Starting Docker Compose stack...");

  const result = runDockerComposeUp();

  if (result.error) {
    throw new Error(`Failed to start Supabase with Docker: ${result.error.message}`);
  }

  if (result.status !== 0) {
    console.log("Docker Compose did not exit cleanly. Checking if Supabase is reachable anyway...");

    if (await waitForSupabase(false)) {
      return;
    }

    throw new Error(`Failed to start Supabase. Docker Compose exited with code ${result.status}.`);
  }

  await waitForSupabase(true);
}

function runDockerComposeUp() {
  return runDocker(["compose", "--env-file", ".env", "-f", "docker-compose.yml", "up", "-d"]);
}

export function ensureMonitoringSchema() {
  const result = runDocker([
    "compose",
    "--env-file",
    ".env",
    "-f",
    "docker-compose.yml",
    "exec",
    "-T",
    "db",
    "psql",
    "-U",
    "postgres",
    "-d",
    "postgres",
    "-v",
    "ON_ERROR_STOP=1"
  ], schemaSql);

  if (result.error) {
    throw new Error(`Failed to create monitoring schema: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`Failed to create monitoring schema. Docker exited with code ${result.status}.`);
  }
}

function runDocker(args: string[], input?: string) {
  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", ["docker", ...args].map(quoteForCmd).join(" ")], {
      cwd: supabaseDir,
      input,
      stdio: input ? ["pipe", "inherit", "inherit"] : "inherit"
    });
  }

  return spawnSync("docker", args, {
    cwd: supabaseDir,
    input,
    stdio: input ? ["pipe", "inherit", "inherit"] : "inherit"
  });
}

function quoteForCmd(value: string) {
  if (!/[ \t\r\n"&|<>^]/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '\\"')}"`;
}

async function waitForSupabase(throwOnTimeout: boolean): Promise<boolean> {
  const timeoutMs = 120_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await isSupabaseApiReady()) {
      console.log("Supabase is ready");
      return true;
    }

    await sleep(2_000);
  }

  if (throwOnTimeout) {
    throw new Error("Supabase did not become ready within 120 seconds.");
  }

  return false;
}

async function isSupabaseApiReady() {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`
      },
      signal: AbortSignal.timeout(3_000)
    });

    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
