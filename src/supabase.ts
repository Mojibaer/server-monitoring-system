import path from "node:path";
import dotenv from "dotenv";
import { sleep } from "./utils";

dotenv.config({ quiet: true });
dotenv.config({ path: path.join(process.cwd(), "supabase", ".env"), override: false, quiet: true });

const supabaseUrl = (process.env.SUPABASE_PUBLIC_URL ?? "http://localhost:8000").replace(/\/$/, "");
const configuredServiceRoleKey = process.env.SERVICE_ROLE_KEY;

if (!configuredServiceRoleKey) {
  throw new Error("SERVICE_ROLE_KEY is missing. Add it to supabase/.env or the root .env file.");
}

const serviceRoleKey: string = configuredServiceRoleKey;

// Supabase is started as a sibling service by Docker Compose (with the schema
// applied via the Postgres init mount). The backend only needs to wait until
// the REST API is reachable before it starts handling traffic.
export async function waitForSupabase(): Promise<void> {
  const timeoutMs = 120_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await isSupabaseApiReady()) {
      console.log("Supabase is ready");
      return;
    }

    console.log("Waiting for Supabase REST API to become reachable...");
    await sleep(2_000);
  }

  throw new Error("Supabase did not become ready within 120 seconds.");
}

async function isSupabaseApiReady() {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/`, {
      // Only apikey — sending Authorization too trips Kong's duplicate-credential 401.
      headers: {
        apikey: serviceRoleKey
      },
      signal: AbortSignal.timeout(3_000)
    });

    return response.ok;
  } catch {
    return false;
  }
}
