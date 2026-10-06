import { describe, expect, it } from 'vitest';
import { AlreadyRedeemedError } from '../../src/main/database/redemptions';
import { isUniqueViolation } from '../../src/main/database/db';
import { VoucherInputError } from '../../src/main/services/issuerService';
import { makePairedWorld, type PairedWorld } from '../helpers/fixtures';
import { LIMITS } from '../../src/shared/constants/index';

const create = (w: PairedWorld, name = 'Example Person', amount = '4.00') =>
  w.issuerSvc.createVoucher({ fullName: name, amount }, { allowCustomAmount: false });

describe('voucher creation', () => {
  it('creates a signed, encrypted voucher that fits one PDF417', async () => {
    const w = await makePairedWorld();
    const v = create(w);
    expect(v.payload.amountPence).toBe(400);
    expect(v.payload.currency).toBe('GBP');
    expect(v.payload.installationIdentifier).toBe(w.issuer.identifier());
    expect(v.barcodeBytes.length).toBeLessThanOrEqual(LIMITS.barcodeBytes);
    expect(v.barcodeBytes.includes(Buffer.from('Example Person'))).toBe(false);
  });

  it('uses the rolling word for the local creation date, including 29 February', async () => {
    const w = await makePairedWorld(new Date('2028-02-29T12:00:00.000Z'));
    const v = create(w);
    expect(v.payload.rollingDateCode).toBe(w.issuer.rollingCodes()!['29-02']);
  });

  it('validates input', async () => {
    const w = await makePairedWorld();
    expect(() => create(w, '')).toThrow(VoucherInputError);
    expect(() => create(w, 'Bad\u0007Name')).toThrow(VoucherInputError);
    expect(() => create(w, 'x'.repeat(61))).toThrow(VoucherInputError);
    expect(() => create(w, 'Name', '0')).toThrow(VoucherInputError);
    expect(() => create(w, 'Name', '4.001')).toThrow(VoucherInputError);
    expect(() => create(w, 'Name', '5.00')).toThrow(/administrator/);
    const custom = w.issuerSvc.createVoucher({ fullName: '  Padded Name  ', amount: '12.50' }, { allowCustomAmount: true });
    expect(custom.payload.fullName).toBe('Padded Name');
    expect(custom.payload.amountPence).toBe(1250);
  });

  it('fits the largest permitted voucher in one symbol', async () => {
    const w = await makePairedWorld();
    const long = 'Ä'.repeat(50);
    const v = w.issuerSvc.createVoucher({ fullName: long, amount: '999999.99' }, { allowCustomAmount: true });
    expect(v.barcodeBytes.length).toBeLessThanOrEqual(LIMITS.barcodeBytes);
  });
});

describe('redemption', () => {
  it('validates, confirms and records a voucher exactly once', async () => {
    const w = await makePairedWorld();
    const v = create(w);
    const first = w.redeemerSvc.validate(v.barcodeBytes);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.voucher.amountDisplay).toBe('£4.00');
    expect(first.voucher.fullName).toBe('Example Person');
    w.clock.now = new Date(w.clock.now.getTime() + 60_000);
    const done = w.redeemerSvc.confirm(first.ticketId);
    expect(done.ok).toBe(true);

    const history = w.redeemerSvc.history('', 'desc');
    expect(history).toHaveLength(1);
    expect(history[0]!.voucherId).toBe(v.payload.voucherId);
    expect(history[0]!.redeemedTime).toMatch(/^\d{2}:\d{2}:\d{2}$/);

    expect(w.redeemerSvc.validate(v.barcodeBytes)).toEqual({ ok: false, code: 'ALREADY_REDEEMED' });
    expect(w.redeemerSvc.confirm(first.ticketId)).toEqual({ ok: false, code: 'TICKET_INVALID' });
    expect(w.redeemerSvc.history('', 'desc')).toHaveLength(1);
  });

  it('cancelling does not record anything and allows a later redemption', async () => {
    const w = await makePairedWorld();
    const v = create(w);
    const r = w.redeemerSvc.validate(v.barcodeBytes);
    if (!r.ok) throw new Error('expected valid');
    expect(w.redeemerSvc.cancel(r.ticketId)).toBe(true);
    expect(w.redeemerSvc.confirm(r.ticketId)).toEqual({ ok: false, code: 'TICKET_INVALID' });
    expect(w.redeemerSvc.history('', 'asc')).toHaveLength(0);
    const again = w.redeemerSvc.validate(v.barcodeBytes);
    expect(again.ok).toBe(true);
  });

  it('searches history by name and UUID', async () => {
    const w = await makePairedWorld();
    const a = create(w, 'Alice Smith');
    const b = create(w, 'Bob 100%');
    for (const v of [a, b]) {
      const r = w.redeemerSvc.validate(v.barcodeBytes);
      if (!r.ok) throw new Error('expected valid');
      w.clock.now = new Date(w.clock.now.getTime() + 1000);
      w.redeemerSvc.confirm(r.ticketId);
    }
    expect(w.redeemerSvc.history('alice', 'asc').map((h) => h.fullName)).toEqual(['Alice Smith']);
    expect(w.redeemerSvc.history(b.payload.voucherId.slice(0, 8), 'asc').map((h) => h.fullName)).toEqual(['Bob 100%']);
    expect(w.redeemerSvc.history('100%', 'asc')).toHaveLength(1);
    expect(w.redeemerSvc.history('%', 'asc')).toHaveLength(1);
    expect(w.redeemerSvc.history('', 'asc')[0]!.fullName).toBe('Alice Smith');
    expect(w.redeemerSvc.history('', 'desc')[0]!.fullName).toBe('Bob 100%');
  });
});

describe('database duplicate protection', () => {
  it('enforces the unique voucherId constraint and immutability in the database', async () => {
    const w = await makePairedWorld();
    const v = create(w);
    const r = w.redeemerSvc.validate(v.barcodeBytes);
    if (!r.ok) throw new Error('expected valid');
    w.redeemerSvc.confirm(r.ticketId);
    const { id: _id, ...row } = w.redeemer.redemptions.all()[0]!;
    expect(() => w.redeemer.redemptions.insert(row)).toThrow(AlreadyRedeemedError);
    expect(() =>
      w.redeemer.db
        .prepare(
          `INSERT INTO redemptions (voucherId, fullName, amountPence, currency, dateCreated, timeCreated, createdAt, dateRedeemed, timeRedeemed, redeemedAt, installationIdentifier, payloadVersion, recordedAt)
           SELECT voucherId, fullName, amountPence, currency, dateCreated, timeCreated, createdAt, dateRedeemed, timeRedeemed, redeemedAt, installationIdentifier, payloadVersion, recordedAt FROM redemptions`,
        )
        .run(),
    ).toThrow(/UNIQUE/);
    try {
      w.redeemer.db.exec(`UPDATE redemptions SET fullName = 'x'`);
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).toMatch(/cannot be modified/);
    }
    expect(isUniqueViolation({ errcode: 2067 })).toBe(true);
  });
});
