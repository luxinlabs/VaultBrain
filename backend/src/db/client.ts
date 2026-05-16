import { Database } from "bun:sqlite";

import { join, dirname } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "..", "..", "dealflow.db");

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.run("PRAGMA journal_mode=WAL");
    db.run("PRAGMA foreign_keys=ON");
  }
  return db;
}

export function query(sql: string, ...params: any[]): any[] {
  const d = getDb();
  const trimmed = sql.trim().toUpperCase();
  if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH") || trimmed.startsWith("PRAGMA")) {
    return d.query(sql).all(...params) as any[];
  } else {
    d.run(sql, ...params);
    return [];
  }
}

export function queryOne(sql: string, ...params: any[]): any | null {
  const d = getDb();
  return (d.query(sql).get(...params) as any) || null;
}
