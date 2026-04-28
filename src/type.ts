export type ServerStatus = "OK" | "WARNING" | "CRITICAL" | "UNKNOWN";

export interface AgentMetricsPayload {
    hostname: string;
    ipAddress?: string;
    cpuUsage: number;
    ramUsage: number;
    diskUsage: number;
}

export interface ClientMessage {
    type: string;
    payload?: unknown;
}
