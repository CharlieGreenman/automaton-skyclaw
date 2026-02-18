import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { HostRecord, JobRecord } from "../types.js";

export class CoordinatorStorage {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    const resolved = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS hosts (
        id TEXT PRIMARY KEY,
        json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        json TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at);
    `);
  }

  loadHosts(): HostRecord[] {
    const rows = this.db.prepare("SELECT json FROM hosts").all() as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as HostRecord);
  }

  loadJobs(): JobRecord[] {
    const rows = this.db
      .prepare("SELECT json FROM jobs ORDER BY created_at ASC")
      .all() as Array<{ json: string }>;
    return rows.map((row) => JSON.parse(row.json) as JobRecord);
  }

  saveHost(host: HostRecord): void {
    this.db
      .prepare(`INSERT INTO hosts (id, json) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json`)
      .run(host.id, JSON.stringify(host));
  }

  saveJob(job: JobRecord): void {
    this.db
      .prepare(
        `INSERT INTO jobs (id, created_at, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at, json=excluded.json`
      )
      .run(job.id, job.createdAt, JSON.stringify(job));
  }
}
