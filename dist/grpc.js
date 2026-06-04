"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startGrpcServer = startGrpcServer;
exports.shutdownGrpcServer = shutdownGrpcServer;
const node_path_1 = __importDefault(require("node:path"));
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const monitoring_1 = require("./monitoring");
const websocket_1 = require("./websocket");
let grpcServer;
const protoPath = node_path_1.default.join(process.cwd(), "proto", "monitoring.proto");
const packageDefinition = protoLoader.loadSync(protoPath, {
    defaults: true,
    enums: String,
    longs: String,
    oneofs: true
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const monitoringPackage = protoDescriptor.monitoring;
function startGrpcServer(port) {
    grpcServer = new grpc.Server();
    grpcServer.addService(monitoringPackage.MonitoringService.service, {
        SubmitMetrics: submitMetrics
    });
    grpcServer.bindAsync(`0.0.0.0:${port}`, grpc.ServerCredentials.createInsecure(), (error, boundPort) => {
        if (error) {
            throw error;
        }
        console.log(`gRPC server started on localhost:${boundPort}`);
    });
}
function shutdownGrpcServer() {
    return new Promise((resolve) => {
        if (!grpcServer) {
            resolve();
            return;
        }
        grpcServer.tryShutdown(() => {
            grpcServer = undefined;
            resolve();
        });
    });
}
function submitMetrics(call, callback) {
    try {
        const storedMetric = (0, monitoring_1.storeAgentMetrics)({
            hostname: call.request.hostname ?? "",
            ipAddress: call.request.ipAddress || undefined,
            cpuUsage: Number(call.request.cpuUsage),
            ramUsage: Number(call.request.ramUsage),
            diskUsage: Number(call.request.diskUsage)
        });
        (0, websocket_1.broadcastToFrontends)({
            type: "metrics_update",
            payload: storedMetric
        });
        console.log(`[AGENT:gRPC] Metrics received from ${storedMetric.hostname} - status: ${storedMetric.status}`);
        callback(null, {
            status: storedMetric.status,
            message: "Metrics received"
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : "Failed to process metrics";
        callback({
            code: grpc.status.INVALID_ARGUMENT,
            message
        });
    }
}
