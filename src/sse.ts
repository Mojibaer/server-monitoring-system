import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import { getInitialMetrics } from "./monitoring";

const frontendClients = new Set<ServerResponse>();
let httpServer: Server | undefined;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*"
};

export function startSseServer(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer = createServer((req, res) => {
      if (req.url === "/events") {
        handleSseConnection(req, res);
        return;
      }

      res.writeHead(404, corsHeaders);
      res.end();
    });

    httpServer.once("error", (error) => {
      httpServer = undefined;
      reject(error);
    });

    httpServer.listen(port, () => {
      console.log(`SSE server started on http://localhost:${port}/events`);
      resolve();
    });
  });
}

export function shutdownSseServer(): Promise<void> {
  return new Promise((resolve) => {
    for (const client of frontendClients) {
      client.end();
    }
    frontendClients.clear();

    if (!httpServer) {
      resolve();
      return;
    }

    httpServer.close(() => {
      httpServer = undefined;
      resolve();
    });
  });
}

function handleSseConnection(req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });

  frontendClients.add(res);
  console.log(`[FRONTEND] Frontend client connected (${frontendClients.size} total)`);

  getInitialMetrics()
    .then((payload) => {
      sendEvent(res, {
        type: "initial_metrics",
        payload
      });
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to load initial metrics";

      sendEvent(res, {
        type: "error",
        payload: { message }
      });
    });

  req.on("close", () => {
    frontendClients.delete(res);
    console.log(`[DISCONNECTED] Frontend client disconnected`);
  });
}

export function broadcastToFrontends(data: object) {
  console.log(`[BROADCAST] Sent update to ${frontendClients.size} frontend clients`);
  for (const client of frontendClients) {
    sendEvent(client, data);
  }
}

function sendEvent(res: ServerResponse, data: object) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}
