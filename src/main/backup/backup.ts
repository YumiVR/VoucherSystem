import { createCipheriv, createDecipheriv } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';
import { z } from 'zod';
import { type Role } from '../../shared/constants/index';
import { canonicalJson } from '../../shared/utilities/canonicalJson';
import { isoTimestamp } from '../../shared/schemas/common';
import { deriveKey } from '../crypto/password';
import { secureBytes } from '../crypto/random';
import { sha256Hex } from '../crypto/keys';
import { inTransaction } from '../database/db';
import { redemptionRecordSchema } from '../database/redemptions';
import type { Installation } from '../services/installation';

const MAGIC = Buffer.from('VRBK', 'ascii');
const VERSION = 1;
const LOG_N = 15;
const HEADER_LEN = 4 + 1 + 1 + 16 + 12;
const TAG_LEN = 16;
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

export class BackupError extends Error {
  constructor(
    public readonly code: 'BAD_FILE' | 'BAD_PASSWORD_OR_CORRUPT' | 'ROLE_MISMATCH' | 'UNSUPPORTED_VERSION' | 'TOO_LARGE',
    message: string,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

const settingRowSchema = z.strictObject({
  key: z.string().min(1).max(100),
  value: z.string().max(200_000).nullable(),
  /** Base64 of the decrypted secret, protected only by the backup encryption. */
  secret: z.string().max(400_000).nullable(),
  updatedAt: isoTimestamp,
});

const auditRowSchema = z.strictObject({
  eventType: z.string().min(1).max(64),
  eventTimestamp: isoTimestamp,
  details: z.string().max(500),
});

const bodySchema = z.strictObject({
  role: z.enum(['issuer', 'redeemer']),
  createdAt: isoTimestamp,
  settings: z.array(settingRowSchema).max(100),
  redemptions: z.array(redemptionRecordSchema).max(2_000_000),
  audit: z.array(auditRowSchema).max(2_000_000),
});
type Body = z.infer<typeof bodySchema>;

const outerSchema = z.strictObject({
  format: z.literal('voucher-redeem-backup'),
  version: z.literal(1),
  body: bodySchema,
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Builds an encrypted backup entirely in memory; no plaintext archive is ever written to disk. */
export async function createBackup(inst: Installation, backupPassword: string): Promise<Buffer> {
  const role = inst.getRole();
  if (!role) throw new BackupError('BAD_FILE', 'Nothing to back up');
  const settings = inst.settings.rows().map((r) => ({
    key: r.key,
    value: r.value,
    secret: r.encryptedValue ? inst.settings.getSecret(r.key)!.toString('base64') : null,
    updatedAt: r.updatedAt,
  }));
  const redemptions = inst.redemptions.all().map((r) => {
    const { id: _id, ...rest } = r;
    return rest;
  });
  const audit = inst.audit.list(1_000_000).reverse().map((a) => ({ eventType: a.eventType, eventTimestamp: a.eventTimestamp, details: a.details }));
  const body: Body = { role, createdAt: inst.now().toISOString(), settings, redemptions, audit };
  const outer = { format: 'voucher-redeem-backup', version: 1, body, checksum: sha256Hex(canonicalJson(body)) };
  const plain = gzipSync(Buffer.from(JSON.stringify(outer), 'utf8'), { level: 9 });

  const salt = secureBytes(16);
  const iv = secureBytes(12);
  const key = await deriveKey(backupPassword, salt, 1 << LOG_N);
  const header = Buffer.concat([MAGIC, Buffer.from([VERSION, LOG_N]), salt, iv]);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  key.fill(0);
  inst.audit.record('BACKUP_CREATED', `role=${role} redemptions=${redemptions.length}`);
  return Buffer.concat([header, cipher.getAuthTag(), ct]);
}

async function decryptBackup(data: Buffer, backupPassword: string): Promise<Body> {
  if (data.length > MAX_BACKUP_BYTES) throw new BackupError('TOO_LARGE', 'Backup file is too large');
  if (data.length < HEADER_LEN + TAG_LEN + 1 || !data.subarray(0, 4).equals(MAGIC)) throw new BackupError('BAD_FILE', 'Not a backup file');
  if (data[4] !== VERSION) throw new BackupError('UNSUPPORTED_VERSION', 'Unsupported backup version');
  const logN = data[5]!;
  if (logN !== LOG_N) throw new BackupError('BAD_FILE', 'Unsupported key-derivation parameters');
  const salt = data.subarray(6, 22);
  const iv = data.subarray(22, 34);
  const tag = data.subarray(HEADER_LEN, HEADER_LEN + TAG_LEN);
  const ct = data.subarray(HEADER_LEN + TAG_LEN);
  const key = await deriveKey(backupPassword, salt, 1 << logN);
  let json: string;
  try {
    const d = createDecipheriv('aes-256-gcm', key, iv);
    d.setAAD(data.subarray(0, HEADER_LEN));
    d.setAuthTag(tag);
    const plain = Buffer.concat([d.update(ct), d.final()]);
    json = gunzipSync(plain, { maxOutputLength: MAX_BACKUP_BYTES * 4 }).toString('utf8');
  } catch {
    throw new BackupError('BAD_PASSWORD_OR_CORRUPT', 'Wrong password or damaged backup');
  } finally {
    key.fill(0);
  }
  const parsed = outerSchema.safeParse(JSON.parse(json));
  if (!parsed.success) throw new BackupError('BAD_FILE', 'Backup content is invalid');
  if (sha256Hex(canonicalJson(parsed.data.body)) !== parsed.data.checksum) {
    throw new BackupError('BAD_PASSWORD_OR_CORRUPT', 'Backup integrity check failed');
  }
  return parsed.data.body;
}

/** Verifies a backup without applying it. */
export async function verifyBackup(data: Buffer, backupPassword: string): Promise<{ role: Role; redemptions: number }> {
  const body = await decryptBackup(data, backupPassword);
  return { role: body.role, redemptions: body.redemptions.length };
}

/** Replaces the local configuration and data with the backup. Allowed only for the same role (or an unconfigured install). */
export async function restoreBackup(inst: Installation, data: Buffer, backupPassword: string): Promise<{ role: Role }> {
  const body = await decryptBackup(data, backupPassword);
  const current = inst.getRole();
  if (current !== null && current !== body.role) throw new BackupError('ROLE_MISMATCH', 'Backup is for a different role');
  inTransaction(inst.db, () => {
    inst.db.exec('DELETE FROM settings');
    inst.db.exec('DELETE FROM redemptions');
    inst.db.exec('DELETE FROM audit_log');
    for (const s of body.settings) {
      if (s.secret !== null) inst.settings.setSecret(s.key, Buffer.from(s.secret, 'base64'));
      else if (s.value !== null) inst.settings.set(s.key, s.value);
      else throw new BackupError('BAD_FILE', 'Setting has no value');
    }
    const ins = inst.db.prepare(
      `INSERT INTO redemptions (voucherId, fullName, amountPence, currency, dateCreated, timeCreated, createdAt,
         dateRedeemed, timeRedeemed, redeemedAt, installationIdentifier, payloadVersion, recordedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const r of body.redemptions) {
      ins.run(r.voucherId, r.fullName, r.amountPence, r.currency, r.dateCreated, r.timeCreated, r.createdAt, r.dateRedeemed, r.timeRedeemed, r.redeemedAt, r.installationIdentifier, r.payloadVersion, r.recordedAt);
    }
    const insAudit = inst.db.prepare('INSERT INTO audit_log (eventType, eventTimestamp, nonSensitiveDetails) VALUES (?, ?, ?)');
    for (const a of body.audit) insAudit.run(a.eventType, a.eventTimestamp, a.details);
    inst.audit.record('BACKUP_RESTORED', `role=${body.role} redemptions=${body.redemptions.length}`);
  });
  return { role: body.role };
}
