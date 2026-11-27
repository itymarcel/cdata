import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface CacheRow {
  id: string;
  payload: string;
  fetchedAt: number;
  dataAsOf: string | null;
}

/**
 * Durable key/value cache backed by SQLite. Each upstream source stores its
 * latest normalised payload here, so a restart serves data immediately and
 * an upstream outage never blanks the dashboard.
 */
export class Cache {
  private db: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS source_cache (
        id          TEXT PRIMARY KEY,
        payload     TEXT NOT NULL,
        fetched_at  INTEGER NOT NULL,
        data_as_of  TEXT
      );
    `);
  }

  get(id: string): CacheRow | null {
    const row = this.db
      .query<{ id: string; payload: string; fetched_at: number; data_as_of: string | null }, [string]>(
        "SELECT id, payload, fetched_at, data_as_of FROM source_cache WHERE id = ?",
      )
      .get(id);
    return row
      ? { id: row.id, payload: row.payload, fetchedAt: row.fetched_at, dataAsOf: row.data_as_of }
      : null;
  }

  set(row: CacheRow): void {
    this.db
      .query(
        `INSERT INTO source_cache (id, payload, fetched_at, data_as_of) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload,
           fetched_at = excluded.fetched_at, data_as_of = excluded.data_as_of`,
      )
      .run(row.id, row.payload, row.fetchedAt, row.dataAsOf);
  }

  close(): void {
    this.db.close();
  }
}
