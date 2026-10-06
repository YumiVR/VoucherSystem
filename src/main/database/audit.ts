import type { AuditEntry } from '../../shared/types/api';
import type { Db } from './db';

const CONTROL = /[\u0000-\u001f\u007f]/g;

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Details must be non-sensitive: no keys, names, barcodes or decrypted payloads. */
  record(eventType: string, details = ''): void {
    this.db
      .prepare('INSERT INTO audit_log (eventType, eventTimestamp, nonSensitiveDetails) VALUES (?, ?, ?)')
      .run(eventType.slice(0, 64), this.now().toISOString(), details.replace(CONTROL, ' ').slice(0, 500));
  }

  list(limit: number): AuditEntry[] {
    const rows = this.db
      .prepare('SELECT id, eventType, eventTimestamp, nonSensitiveDetails FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; eventType: string; eventTimestamp: string; nonSensitiveDetails: string }[];
    return rows.map((r) => ({ id: r.id, eventType: r.eventType, eventTimestamp: r.eventTimestamp, details: r.nonSensitiveDetails }));
  }
}
