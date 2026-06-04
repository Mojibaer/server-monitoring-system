import { WebSocketServer, WebSocket } from "ws";
import { getInitialMetrics } from "./monitoring";

type ClientType = "frontend" | "unknown";

interface ExtendedWebSocket extends WebSocket {
  clientType: ClientType;
  isAlive: boolean;
}

interface RegisterFrontendMessage {
  type: "frontend_register";
}

type ClientMessage = RegisterFrontendMessage;

const frontendClients = new Set<ExtendedWebSocket>();
let wss: WebSocketServer;
let pingInterval: ReturnType<typeof setInterval>;

export function startWebSocketServer(port: number) {
  wss = new WebSocketServer({ port });

  pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as ExtendedWebSocket;
      if (!ws.isAlive) {
        frontendClients.delete(ws);
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on("connection", (ws: ExtendedWebSocket) => {
    ws.clientType = "unknown";
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    console.log(`[CONNECTED] New client connected`);

    ws.on("message", (rawData) => {
      try {
        const message = JSON.parse(rawData.toString()) as ClientMessage;

        if (message.type === "frontend_register") {
          handleFrontendRegister(ws);
          return;
        }

        sendError(ws, "Unknown message type");
      } catch {
        sendError(ws, "Invalid JSON message");
      }
    });

    ws.on("close", () => {
      frontendClients.delete(ws);
      console.log(`[DISCONNECTED] ${ws.clientType} client disconnected`);
    });

    ws.on("error", () => {
      frontendClients.delete(ws);
    });
  });

  wss.on("close", () => clearInterval(pingInterval));

  console.log(`WebSocket server started on ws://localhost:${port}`);
}

export function shutdownWebSocketServer(): Promise<void> {
  clearInterval(pingInterval);
  return new Promise((resolve) => {
    for (const client of wss.clients) {
      client.terminate();
    }
    wss.close(() => resolve());
  });
}

function handleFrontendRegister(ws: ExtendedWebSocket) {
  ws.clientType = "frontend";
  frontendClients.add(ws);
  console.log(`[FRONTEND] Frontend client registered`);

  sendJson(ws, {
    type: "initial_metrics",
    payload: getInitialMetrics()
  });
}

export function broadcastToFrontends(data: object) {
  console.log(`[BROADCAST] Sent update to ${frontendClients.size} frontend clients`);
  for (const client of frontendClients) {
    if (client.readyState === WebSocket.OPEN) {
      sendJson(client, data);
    }
  }
}

function sendJson(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws: WebSocket, message: string) {
  sendJson(ws, { type: "error", message });
}
