import type { Db } from './db';
import type { SecretProtector } from '../crypto/protector';

export interface SettingRow {
  key: string;
  value: string | null;
  encryptedValue: Uint8Array | null;
  updatedAt: string;
}

export class SettingsStore {
  constructor(
    private readonly db: Db,
    private readonly protector: SecretProtector,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string | null } | undefined;
    return row?.value ?? null;
  }

  set(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, encryptedValue, updatedAt) VALUES (?, ?, NULL, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, encryptedValue = NULL, updatedAt = excluded.updatedAt`,
      )
      .run(key, value, this.now().toISOString());
  }

  getSecret(key: string): Buffer | null {
    const row = this.db.prepare('SELECT encryptedValue FROM settings WHERE key = ?').get(key) as
      | { encryptedValue: Uint8Array | null }
      | undefined;
    if (!row?.encryptedValue) return null;
    return this.protector.unprotect(row.encryptedValue);
  }

  setSecret(key: string, plain: Uint8Array): void {
    if (!this.protector.isAvailable()) throw new Error('Operating-system secure storage is not available');
    const protectedBytes = this.protector.protect(plain);
    this.db
      .prepare(
        `INSERT INTO settings (key, value, encryptedValue, updatedAt) VALUES (?, NULL, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = NULL, encryptedValue = excluded.encryptedValue, updatedAt = excluded.updatedAt`,
      )
      .run(key, protectedBytes, this.now().toISOString());
  }

  getJsonSecret<T>(key: string): T | null {
    const raw = this.getSecret(key);
    return raw ? (JSON.parse(raw.toString('utf8')) as T) : null;
  }

  setJsonSecret(key: string, value: unknown): void {
    this.setSecret(key, Buffer.from(JSON.stringify(value), 'utf8'));
  }

  delete(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  rows(): SettingRow[] {
    return this.db.prepare('SELECT key, value, encryptedValue, updatedAt FROM settings ORDER BY key').all() as unknown as SettingRow[];
  }
}
