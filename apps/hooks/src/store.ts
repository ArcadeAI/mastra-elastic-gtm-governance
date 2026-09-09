import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** One process owns this database; each state transition is a short immediate transaction. */
export class Store {
  readonly db: Database;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec(`CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, body TEXT NOT NULL);`);
  }
  get<T>(kind: string, id: string): T | null {
    const row = this.db.query<{ body: string }, [string, string]>("SELECT body FROM records WHERE kind=? AND id=?").get(kind, id);
    return row ? JSON.parse(row.body) as T : null;
  }
  all<T>(kind: string): T[] {
    return this.db.query<{ body: string }, [string]>("SELECT body FROM records WHERE kind=?").all(kind).map(row => JSON.parse(row.body) as T);
  }
  put(kind: string, id: string, body: unknown) {
    this.db.query("INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body").run(kind, id, JSON.stringify(body));
  }
  transaction<T>(fn: () => T): T { return this.db.transaction(fn).immediate(); }
  event(runId: string | null, body: unknown) { this.db.query("INSERT INTO audit(run_id,body) VALUES (?,?)").run(runId, JSON.stringify(body)); }
  audit(runId: string, after: number) {
    return this.db.query<{ seq: number; body: string }, [string, number]>("SELECT seq,body FROM audit WHERE run_id=? AND seq>? ORDER BY seq LIMIT 200").all(runId, after).map(row => ({ ...JSON.parse(row.body), seq: row.seq }));
  }
  reset() { this.db.exec("DELETE FROM records; DELETE FROM audit;"); }
  close() { this.db.close(); }
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
