"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
exports.initDatabase = initDatabase;
exports.seedDatabase = seedDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
exports.db = new better_sqlite3_1.default("data/monitoring.db");
function initDatabase() {
    exports.db.exec(`
        CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        hostname TEXT NOT NULL UNIQUE,
        ip_address TEXT,
        last_seen TEXT
        );

        CREATE TABLE IF NOT EXISTS metrics(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER NOT NULL,
        cpu_usage REAL NOT NULL,
        ram_usage REAL NOT NULL,
        disk_usage REAL NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (server_id) REFERENCES servers(id)
        );
    `);
}
function seedDatabase() {
    const insertServer = exports.db.prepare(`
    INSERT OR IGNORE INTO servers (hostname, ip_address, last_seen)
    VALUES (?, ?, datetime('now'))
  `);
    insertServer.run("linux-server-01", "192.168.1.50");
    insertServer.run("linux-server-02", "192.168.1.51");
    const getServer = exports.db.prepare(`
    SELECT id FROM servers WHERE hostname = ?
  `);
    const insertMetric = exports.db.prepare(`
    INSERT INTO metrics (server_id, cpu_usage, ram_usage, disk_usage)
    VALUES (?, ?, ?, ?)
  `);
    const server1 = getServer.get("linux-server-01");
    const server2 = getServer.get("linux-server-02");
    insertMetric.run(server1.id, 35.5, 62.1, 70.3);
    insertMetric.run(server1.id, 42.8, 65.4, 71.0);
    insertMetric.run(server2.id, 55.2, 73.6, 81.4);
}
