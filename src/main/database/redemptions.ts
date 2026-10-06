import { z } from 'zod';
import { installationIdentifier, isoDate, isoTime, isoTimestamp, uuidV4 } from '../../shared/schemas/common';
import { fullNameSchema } from '../../shared/schemas/protocol';
import { inTransaction, isUniqueViolation, type Db } from './db';

export class AlreadyRedeemedError extends Error {
  constructor() {
    super('Voucher already redeemed');
    this.name = 'AlreadyRedeemedError';
  }
}

export const redemptionRecordSchema = z.strictObject({
  voucherId: uuidV4,
  fullName: fullNameSchema,
  amountPence: z.number().int().min(1),
  currency: z.literal('GBP'),
  dateCreated: isoDate,
  timeCreated: isoTime,
  createdAt: isoTimestamp,
  dateRedeemed: isoDate,
  timeRedeemed: isoTime,
  redeemedAt: isoTimestamp,
  installationIdentifier,
  payloadVersion: z.number().int().min(1),
  recordedAt: isoTimestamp,
});
export type RedemptionRecord = z.infer<typeof redemptionRecordSchema>;

export interface RedemptionRow extends RedemptionRecord {
  id: number;
}

const COLUMNS =
  'id, voucherId, fullName, amountPence, currency, dateCreated, timeCreated, createdAt, dateRedeemed, timeRedeemed, redeemedAt, installationIdentifier, payloadVersion, recordedAt';

export class RedemptionStore {
  constructor(private readonly db: Db) {}

  exists(voucherId: string): boolean {
    return this.db.prepare('SELECT 1 AS x FROM redemptions WHERE voucherId = ?').get(voucherId) !== undefined;
  }

  /**
   * Inserts inside a transaction. The UNIQUE constraint on voucherId is the authoritative duplicate guard;
   * `alsoInTransaction` lets callers add related writes (e.g. an audit event) atomically.
   */
  insert(record: RedemptionRecord, alsoInTransaction?: () => void): void {
    const r = redemptionRecordSchema.parse(record);
    try {
      inTransaction(this.db, () => {
        this.db
          .prepare(
            `INSERT INTO redemptions (voucherId, fullName, amountPence, currency, dateCreated, timeCreated, createdAt,
               dateRedeemed, timeRedeemed, redeemedAt, installationIdentifier, payloadVersion, recordedAt)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            r.voucherId,
            r.fullName,
            r.amountPence,
            r.currency,
            r.dateCreated,
            r.timeCreated,
            r.createdAt,
            r.dateRedeemed,
            r.timeRedeemed,
            r.redeemedAt,
            r.installationIdentifier,
            r.payloadVersion,
            r.recordedAt,
          );
        alsoInTransaction?.();
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AlreadyRedeemedError();
      throw err;
    }
  }

  list(search: string, order: 'asc' | 'desc'): RedemptionRow[] {
    const dir = order === 'asc' ? 'ASC' : 'DESC';
    const term = search.trim();
    if (term === '') {
      return this.db.prepare(`SELECT ${COLUMNS} FROM redemptions ORDER BY redeemedAt ${dir}, id ${dir}`).all() as unknown as RedemptionRow[];
    }
    const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return this.db
      .prepare(
        `SELECT ${COLUMNS} FROM redemptions
         WHERE fullName LIKE ? ESCAPE '\\' OR voucherId LIKE ? ESCAPE '\\'
         ORDER BY redeemedAt ${dir}, id ${dir}`,
      )
      .all(like, like) as unknown as RedemptionRow[];
  }

  all(): RedemptionRow[] {
    return this.db.prepare(`SELECT ${COLUMNS} FROM redemptions ORDER BY id`).all() as unknown as RedemptionRow[];
  }
}
