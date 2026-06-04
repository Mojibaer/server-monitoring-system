import { ServerStatus, AgentMetricsPayload } from "./type";

export function calculateStatus(metrics: AgentMetricsPayload): ServerStatus {
    if (
        metrics.cpuUsage >= 90 ||
        metrics.ramUsage >= 90 ||
        metrics.diskUsage >= 95
    ) {
        return "CRITICAL";
    }

    if (
        metrics.cpuUsage >= 70 ||
        metrics.ramUsage >= 75 ||
        metrics.diskUsage >= 80
    ) {
        return "WARNING";
    }

    return "OK";
}
