import Database from "better-sqlite3";

export const db = new Database("data/monitoring.db");

export function initDatabase(){
    db.exec(`
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

export function seedDatabase() {
  const insertServer = db.prepare(`
    INSERT OR IGNORE INTO servers (hostname, ip_address, last_seen)
    VALUES (?, ?, datetime('now'))
  `);

  insertServer.run("linux-server-01", "192.168.1.50");
  insertServer.run("linux-server-02", "192.168.1.51");

  const getServer = db.prepare(`
    SELECT id FROM servers WHERE hostname = ?
  `);

  const insertMetric = db.prepare(`
    INSERT INTO metrics (server_id, cpu_usage, ram_usage, disk_usage)
    VALUES (?, ?, ?, ?)
  `);

  const server1 = getServer.get("linux-server-01") as { id: number };
  const server2 = getServer.get("linux-server-02") as { id: number };

  insertMetric.run(server1.id, 35.5, 62.1, 70.3);
  insertMetric.run(server1.id, 42.8, 65.4, 71.0);
  insertMetric.run(server2.id, 55.2, 73.6, 81.4);
}