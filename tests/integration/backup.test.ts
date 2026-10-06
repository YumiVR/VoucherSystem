import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BackupError, createBackup, restoreBackup, verifyBackup } from '../../src/main/backup/backup';
import { openDatabase, runMigrations } from '../../src/main/database/db';
import { RedeemerService } from '../../src/main/services/redeemerService';
import { ADMIN_PASSWORD, MIGRATIONS_DIR, makeInstallation, makePairedWorld } from '../helpers/fixtures';

const BACKUP_PASSWORD = 'a separate backup password';

describe('backup and restore', () => {
  it('restores keys, pairing, expiry and redemption history into a fresh installation', async () => {
    const w = await makePairedWorld();
    const make = () => w.issuerSvc.createVoucher({ fullName: 'Backup Person', amount: '4' }, { allowCustomAmount: false });
    const redeemed = make();
    const pending = make();
    const r = w.redeemerSvc.validate(redeemed.barcodeBytes);
    if (!r.ok) throw new Error('expected valid');
    w.redeemerSvc.confirm(r.ticketId);

    const file = await createBackup(w.redeemer, BACKUP_PASSWORD);
    expect(file.includes(Buffer.from('Backup Person'))).toBe(false);
    expect(file.subarray(0, 4).toString()).toBe('VRBK');
    expect(await verifyBackup(file, BACKUP_PASSWORD)).toEqual({ role: 'redeemer', redemptions: 1 });

    const fresh = makeInstallation(w.clock);
    expect(await restoreBackup(fresh, file, BACKUP_PASSWORD)).toEqual({ role: 'redeemer' });
    expect(await fresh.verifyAdminPassword(ADMIN_PASSWORD)).toBe(true);
    const svc = new RedeemerService(fresh);
    expect(svc.validate(redeemed.barcodeBytes)).toEqual({ ok: false, code: 'ALREADY_REDEEMED' });
    expect(svc.validate(pending.barcodeBytes).ok).toBe(true);
    expect(svc.getExpiry().expiryIso).toBe('2026-12-31T23:59:59.000Z');
    expect(fresh.audit.list(100).some((e) => e.eventType === 'BACKUP_RESTORED')).toBe(true);
  });

  it('rejects wrong passwords, tampering and incompatible roles', async () => {
    const w = await makePairedWorld();
    const file = await createBackup(w.redeemer, BACKUP_PASSWORD);
    await expect(verifyBackup(file, 'wrong password!!')).rejects.toMatchObject({ code: 'BAD_PASSWORD_OR_CORRUPT' });
    const tampered = Buffer.from(file);
    tampered[tampered.length - 3] = tampered[tampered.length - 3]! ^ 1;
    await expect(verifyBackup(tampered, BACKUP_PASSWORD)).rejects.toBeInstanceOf(BackupError);
    await expect(verifyBackup(Buffer.from('nonsense nonsense nonsense nonsense nonsense'), BACKUP_PASSWORD)).rejects.toMatchObject({ code: 'BAD_FILE' });
    await expect(restoreBackup(w.issuer, file, BACKUP_PASSWORD)).rejects.toMatchObject({ code: 'ROLE_MISMATCH' });
    const unsupported = Buffer.from(file);
    unsupported[4] = 9;
    await expect(verifyBackup(unsupported, BACKUP_PASSWORD)).rejects.toMatchObject({ code: 'UNSUPPORTED_VERSION' });
  });
});

describe('installation reset', () => {
  it('removes keys, configuration and redemptions but keeps an audit record', async () => {
    const w = await makePairedWorld();
    const v = w.issuerSvc.createVoucher({ fullName: 'Reset Person', amount: '4' }, { allowCustomAmount: false });
    const r = w.redeemerSvc.validate(v.barcodeBytes);
    if (!r.ok) throw new Error('expected valid');
    w.redeemerSvc.confirm(r.ticketId);
    w.redeemer.reset();
    expect(w.redeemer.getRole()).toBeNull();
    expect(w.redeemer.redemptions.all()).toHaveLength(0);
    expect(w.redeemer.settings.rows()).toHaveLength(0);
    expect(w.redeemer.audit.list(100).some((e) => e.eventType === 'INSTALLATION_RESET')).toBe(true);
    await w.redeemer.setup('issuer', ADMIN_PASSWORD);
    expect(w.redeemer.getRole()).toBe('issuer');
  });

  it('refuses to configure a second role without a reset', async () => {
    const w = await makePairedWorld();
    await expect(w.issuer.setup('redeemer', ADMIN_PASSWORD)).rejects.toMatchObject({ code: 'ALREADY_CONFIGURED' });
  });
});

describe('database migrations', () => {
  it('applies migrations once, creates the required tables and is idempotent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vr-db-'));
    try {
      const db = openDatabase(join(dir, 'test.db'), MIGRATIONS_DIR);
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
      expect(tables).toEqual(expect.arrayContaining(['redemptions', 'settings', 'audit_log', 'schema_migrations']));
      const cols = (db.prepare('PRAGMA table_info(redemptions)').all() as { name: string }[]).map((c) => c.name);
      expect(cols).toEqual(
        expect.arrayContaining(['id', 'voucherId', 'fullName', 'amountPence', 'currency', 'dateCreated', 'timeCreated', 'createdAt', 'dateRedeemed', 'timeRedeemed', 'redeemedAt', 'installationIdentifier', 'payloadVersion', 'recordedAt']),
      );
      expect(runMigrations(db, MIGRATIONS_DIR).applied).toEqual([]);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('applies new migrations to an existing database and rejects a newer schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vr-mig-'));
    try {
      const migDir = join(dir, 'migrations');
      mkdirSync(migDir);
      writeFileSync(join(migDir, '001_a.sql'), 'CREATE TABLE a (x INTEGER) STRICT;');
      const db = new DatabaseSync(':memory:');
      expect(runMigrations(db, migDir).applied).toEqual(['001_a.sql']);
      writeFileSync(join(migDir, '002_b.sql'), 'CREATE TABLE b (y INTEGER) STRICT;');
      expect(runMigrations(db, migDir).applied).toEqual(['002_b.sql']);
      writeFileSync(join(migDir, '003_bad.sql'), 'CREATE TABLE c (z INTEGER) STRICT; THIS IS NOT SQL;');
      expect(() => runMigrations(db, migDir)).toThrow();
      const tables = (db.prepare("SELECT name FROM sqlite_master WHERE name = 'c'").all()).length;
      expect(tables).toBe(0);
      const older = join(dir, 'older');
      mkdirSync(older);
      writeFileSync(join(older, '001_a.sql'), 'SELECT 1;');
      expect(() => runMigrations(db, older)).toThrow(/newer version/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
