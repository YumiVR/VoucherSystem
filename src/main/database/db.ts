import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Db = DatabaseSync;

export interface MigrationResult {
  applied: string[];
  currentVersion: number;
}

interface MigrationFile {
  version: number;
  name: string;
  sql: string;
}

function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((f) => ({ version: Number(f.slice(0, 3)), name: f, sql: readFileSync(join(dir, f), 'utf8') }));
}

export function runMigrations(db: Db, migrationsDir: string, now: () => Date = () => new Date()): MigrationResult {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       version   INTEGER PRIMARY KEY,
       name      TEXT NOT NULL,
       appliedAt TEXT NOT NULL
     ) STRICT`,
  );
  const files = loadMigrations(migrationsDir);
  const known = new Set(files.map((f) => f.version));
  const existing = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[];
  for (const row of existing) {
    if (!known.has(row.version)) throw new Error('Database was created by a newer version of the application');
  }
  const done = new Set(existing.map((r) => r.version));
  const applied: string[] = [];
  for (const m of files) {
    if (done.has(m.version)) continue;
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, appliedAt) VALUES (?, ?, ?)').run(
        m.version,
        m.name,
        now().toISOString(),
      );
      db.exec('COMMIT');
      applied.push(m.name);
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  const last = files.length ? files[files.length - 1]!.version : 0;
  return { applied, currentVersion: last };
}

export function openDatabase(path: string, migrationsDir: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = FULL');
  db.exec('PRAGMA secure_delete = ON');
  runMigrations(db, migrationsDir);
  return db;
}

/** Runs fn inside an immediate transaction; rolls back on any thrown error. */
export function inTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { errcode?: number; message?: string };
  return e.errcode === 2067 || e.errcode === 1555 || /UNIQUE constraint failed/i.test(e.message ?? '');
}
