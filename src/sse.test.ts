import test from "node:test";
import assert from "node:assert/strict";
import { broadcastToFrontends, startSseServer, shutdownSseServer } from "./sse";
import { initDatabase } from "./db";

const SSE_URL = "http://localhost:8090/events";

// Reads an SSE stream and resolves once a message of the wanted type arrives.
// onFirst runs after the first event, so tests can trigger a broadcast.
async function waitForEvent(
  type: string,
  onFirst?: () => void
): Promise<Record<string, unknown>> {
  const response = await fetch(SSE_URL);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seenFirst = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        throw new Error("stream closed before event arrived");
      }

      buffer += decoder.decode(value, { stream: true });

      let separator: number;
      while ((separator = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);

        const data = frame.replace(/^data: /, "");
        const msg = JSON.parse(data);

        if (!seenFirst) {
          seenFirst = true;
          onFirst?.();
        }

        if (msg.type === type) {
          return msg;
        }
      }
    }
  } finally {
    await reader.cancel();
  }
}

test.before(() => {
  initDatabase();
  startSseServer(8090);
});

test.after(async () => {
  await shutdownSseServer();
});

test("client can connect", async () => {
  const response = await fetch(SSE_URL);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/event-stream");
  await response.body!.cancel();
});

test("frontend receives initial_metrics", async () => {
  const msg = await waitForEvent("initial_metrics");
  assert.equal(msg.type, "initial_metrics");
});

test("frontend receives metrics_update broadcast", async () => {
  const msg = await waitForEvent("metrics_update", () => {
    broadcastToFrontends({
      type: "metrics_update",
      payload: {
        hostname: "broadcast-test",
        ipAddress: "192.168.1.10",
        cpuUsage: 44,
        ramUsage: 55,
        diskUsage: 66,
        status: "OK",
        timestamp: new Date().toISOString()
      }
    });
  });

  assert.equal(msg.type, "metrics_update");
});
