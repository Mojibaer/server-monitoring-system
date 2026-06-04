"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateStatus = calculateStatus;
function calculateStatus(metrics) {
    if (metrics.cpuUsage >= 90 ||
        metrics.ramUsage >= 90 ||
        metrics.diskUsage >= 95) {
        return "CRITICAL";
    }
    if (metrics.cpuUsage >= 70 ||
        metrics.ramUsage >= 75 ||
        metrics.diskUsage >= 80) {
        return "WARNING";
    }
    return "OK";
}
