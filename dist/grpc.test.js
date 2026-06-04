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
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_path_1 = __importDefault(require("node:path"));
const grpc = __importStar(require("@grpc/grpc-js"));
const protoLoader = __importStar(require("@grpc/proto-loader"));
const db_1 = require("./db");
const grpc_1 = require("./grpc");
const grpcPort = 50052;
const protoPath = node_path_1.default.join(process.cwd(), "proto", "monitoring.proto");
const packageDefinition = protoLoader.loadSync(protoPath, {
    defaults: true,
    enums: String,
    longs: String,
    oneofs: true
});
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const monitoringPackage = protoDescriptor.monitoring;
node_test_1.default.before(() => {
    (0, db_1.initDatabase)();
    (0, grpc_1.startGrpcServer)(grpcPort);
});
node_test_1.default.after(async () => {
    await (0, grpc_1.shutdownGrpcServer)();
});
(0, node_test_1.default)("agent can submit metrics over gRPC", async () => {
    const client = new monitoringPackage.MonitoringService(`localhost:${grpcPort}`, grpc.credentials.createInsecure());
    const response = await new Promise((resolve, reject) => {
        client.SubmitMetrics({
            hostname: "grpc-test-agent",
            ipAddress: "127.0.0.1",
            cpuUsage: 35,
            ramUsage: 50,
            diskUsage: 60
        }, (error, result) => {
            client.close();
            if (error) {
                reject(error);
                return;
            }
            resolve(result);
        });
    });
    strict_1.default.equal(response.status, "OK");
    strict_1.default.equal(response.message, "Metrics received");
});
