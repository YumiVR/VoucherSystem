import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MemorySecretProtector } from '../../src/main/crypto/protector';
import { runMigrations } from '../../src/main/database/db';
import { createHandlersContext } from '../../src/main/bootstrap';
import { AppError, createHandlers, toSafeError, type UiHooks } from '../../src/main/ipc/handlers';
import { AdminError } from '../../src/main/services/adminSession';
import { ipcRequestSchemas } from '../../src/shared/schemas/ipc';
import { IPC_CHANNELS } from '../../src/shared/types/api';
import { toBase64 } from '../../src/shared/utilities/base64';
import { bytesToDigits } from '../../src/shared/utilities/numeric';
import { ADMIN_PASSWORD, FONTS_DIR, MIGRATIONS_DIR } from '../helpers/fixtures';

function node(clock: { now: Date }) {
  const db = new DatabaseSync(':memory:');
  runMigrations(db, MIGRATIONS_DIR);
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const ui: UiHooks = {
    savePdf: async (name, bytes) => (saved.push({ name, bytes }), true),
    openForPrint: async (name, bytes) => (saved.push({ name, bytes }), true),
    saveBackup: async () => true,
    openBackup: async () => null,
  };
  const ctx = createHandlersContext({ db, protector: new MemorySecretProtector(), fontsDir: FONTS_DIR, ui, launchRole: 'redeemer', now: () => clock.now });
  return { ctx, h: createHandlers(ctx), saved };
}

describe('IPC handlers', () => {
  it('runs the whole pairing, issuing and redeeming flow through the handler layer', async () => {
    const clock = { now: new Date('2026-05-04T08:00:00.000Z') };
    const issuer = node(clock);
    const redeemer = node(clock);

    await issuer.h['setup:begin']({ role: 'issuer', adminPassword: ADMIN_PASSWORD });
    await redeemer.h['setup:begin']({ role: 'redeemer', adminPassword: ADMIN_PASSWORD });

    const req = await issuer.h['issuer:getPairingRequest'](undefined);
    expect(req.barcode.dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const requestBytes = Buffer.from(issuer.ctx.issuer.pairingRequestText());
    const setup = await redeemer.h['redeemer:submitPairingRequest']({ dataBase64: toBase64(requestBytes) });
    expect(setup.parts.length).toBeGreaterThan(1);

    const texts = redeemer.ctx.redeemer.setupPartTexts();
    let progress;
    for (const t of texts) progress = await issuer.h['issuer:submitSetupPart']({ dataBase64: toBase64(Buffer.from(t)) });
    expect(progress?.paired).toBe(true);

    await redeemer.h['expiry:set']({ expiryIso: '2026-12-31T23:59:59.000Z', timeZone: 'Europe/London', confirmed: true });

    const created = await issuer.h['voucher:create']({ fullName: 'Handler Person', amount: '4.00' });
    expect(created.amountDisplay).toBe('£4.00');
    expect(created.dateCreatedUk).toBe('04/05/2026');
    await issuer.h['voucher:savePdf']({ voucherId: created.voucherId });
    expect(issuer.saved[0]!.name).toBe(`voucher_${created.voucherId}.pdf`);
    expect(Buffer.from(issuer.saved[0]!.bytes).subarray(0, 4).toString()).toBe('%PDF');

    // The scan arrives as the exact barcode bytes; reproduce them from the issuer service.
    const issued = issuer.ctx.issuer.createVoucher({ fullName: 'Scan Person', amount: '4' }, { allowCustomAmount: false });
    const outcome = await redeemer.h['redeemer:validate']({ dataBase64: toBase64(Buffer.from(bytesToDigits(issued.barcodeBytes))) });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const done = await redeemer.h['redeemer:confirm']({ ticketId: outcome.ticketId });
    expect(done.ok).toBe(true);
    const again = await redeemer.h['redeemer:validate']({ dataBase64: toBase64(Buffer.from(bytesToDigits(issued.barcodeBytes))) });
    expect(again).toEqual({ ok: false, code: 'ALREADY_REDEEMED' });
    const history = await redeemer.h['history:list']({ search: 'scan', order: 'desc' });
    expect(history.entries.map((e) => e.fullName)).toEqual(['Scan Person']);
  });

  it('never returns private key material and gates administrator functions', async () => {
    const clock = { now: new Date('2026-05-04T08:00:00.000Z') };
    const n = node(clock);
    await n.h['setup:begin']({ role: 'redeemer', adminPassword: ADMIN_PASSWORD });
    const priv = n.ctx.inst.privateKeyDer().toString('base64');
    const privChunk = priv.slice(100, 140);

    await n.h['admin:lock'](undefined);
    await expect(n.h['audit:list']({ limit: 10 })).rejects.toBeInstanceOf(AdminError);
    await expect(n.h['redeemer:getSetupParts'](undefined)).rejects.toBeInstanceOf(AdminError);
    await expect(n.h['expiry:set']({ expiryIso: '2030-01-01T00:00:00.000Z', timeZone: 'UTC', confirmed: true })).rejects.toBeInstanceOf(AdminError);

    await n.h['admin:unlock']({ password: ADMIN_PASSWORD });
    const outputs = JSON.stringify([
      await n.h['app:getState'](undefined),
      await n.h['pairing:getStatus'](undefined),
      await n.h['audit:list']({ limit: 100 }),
      await n.h['branding:get'](undefined),
    ]);
    expect(outputs).not.toContain(privChunk);
    expect(outputs).not.toContain('PRIVATE');
  });

  it('only allows non-standard amounts for an unlocked administrator', async () => {
    const clock = { now: new Date('2026-05-04T08:00:00.000Z') };
    const issuer = node(clock);
    const redeemer = node(clock);
    await issuer.h['setup:begin']({ role: 'issuer', adminPassword: ADMIN_PASSWORD });
    await redeemer.h['setup:begin']({ role: 'redeemer', adminPassword: ADMIN_PASSWORD });
    await redeemer.h['redeemer:submitPairingRequest']({ dataBase64: toBase64(Buffer.from(issuer.ctx.issuer.pairingRequestText())) });
    for (const t of redeemer.ctx.redeemer.setupPartTexts()) await issuer.h['issuer:submitSetupPart']({ dataBase64: toBase64(Buffer.from(t)) });

    await issuer.h['admin:lock'](undefined);
    await expect(issuer.h['voucher:create']({ fullName: 'A', amount: '9.00' })).rejects.toThrow(/administrator/);
    await issuer.h['admin:unlock']({ password: ADMIN_PASSWORD });
    const v = await issuer.h['voucher:create']({ fullName: 'A', amount: '9.00' });
    expect(v.amountPence).toBe(900);
  });

  it('throttles repeated wrong administrator passwords', async () => {
    const n = node({ now: new Date() });
    await n.h['setup:begin']({ role: 'issuer', adminPassword: ADMIN_PASSWORD });
    await n.h['admin:lock'](undefined);
    for (let i = 0; i < 5; i++) await expect(n.h['admin:unlock']({ password: 'wrong' })).rejects.toMatchObject({ code: 'BAD_PASSWORD' });
    await expect(n.h['admin:unlock']({ password: ADMIN_PASSWORD })).rejects.toMatchObject({ code: 'LOCKED_OUT' });
  });

  it('resets only with the administrator password', async () => {
    const n = node({ now: new Date() });
    await n.h['setup:begin']({ role: 'issuer', adminPassword: ADMIN_PASSWORD });
    await expect(n.h['installation:reset']({ adminPassword: 'wrong', confirmation: 'RESET' })).rejects.toBeInstanceOf(AdminError);
    expect((await n.h['app:getState'](undefined)).role).toBe('issuer');
    const state = await n.h['installation:reset']({ adminPassword: ADMIN_PASSWORD, confirmation: 'RESET' });
    expect(state.role).toBeNull();
  });

  it('hides internal error details from operators', () => {
    const e = toSafeError(new Error('RSA key d=123456 failed at /secret/path'));
    expect(e).toEqual({ code: 'INTERNAL', message: expect.not.stringContaining('RSA') });
    expect(toSafeError(new AppError('X', 'Safe text')).message).toBe('Safe text');
  });
});

describe('IPC request schemas', () => {
  it('defines a schema for every channel', () => {
    for (const c of IPC_CHANNELS) expect(ipcRequestSchemas[c]).toBeDefined();
  });

  it('rejects unknown fields, bad types and oversized input', () => {
    const s = ipcRequestSchemas;
    expect(s['voucher:create'].safeParse({ fullName: 'A', amount: '4', extra: 1 }).success).toBe(false);
    expect(s['voucher:create'].safeParse({ fullName: 'A'.repeat(500), amount: '4' }).success).toBe(false);
    expect(s['redeemer:validate'].safeParse({ dataBase64: 'not base64!' }).success).toBe(false);
    expect(s['redeemer:validate'].safeParse({ dataBase64: 'A'.repeat(5000) }).success).toBe(false);
    expect(s['installation:reset'].safeParse({ adminPassword: 'x', confirmation: 'yes' }).success).toBe(false);
    expect(s['setup:begin'].safeParse({ role: 'admin', adminPassword: ADMIN_PASSWORD }).success).toBe(false);
    expect(s['setup:begin'].safeParse({ role: 'issuer', adminPassword: 'short' }).success).toBe(false);
    expect(s['app:getState'].safeParse({}).success).toBe(false);
    expect(s['history:list'].safeParse({ search: '', order: 'sideways' }).success).toBe(false);
    expect(s['branding:set'].safeParse({ organisationName: 'x', primaryColour: 'red', secondaryColour: '#000000', textColour: '#000000', footerText: '', layout: 'wallet', logo: null }).success).toBe(false);
  });
});
