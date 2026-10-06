import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { CLOCK_ROLLBACK_TOLERANCE_MS, FUTURE_TOLERANCE_MS } from '../../src/shared/constants/index';
import type { RedeemFailureCode } from '../../src/shared/constants/messages';
import { decodeEnvelope, encodeEnvelope, encryptEnvelope } from '../../src/main/crypto/envelope';
import { generateRsaKeyPair } from '../../src/main/crypto/keys';
import { signData } from '../../src/main/crypto/signature';
import { ExpiryError } from '../../src/main/services/redeemerService';
import { encodeVoucherPayload } from '../../src/main/vouchers/payloadCodec';
import { signedBytesOf } from '../../src/main/vouchers/voucherCrypto';
import { craftVoucher, makePairedWorld, type PairedWorld } from '../helpers/fixtures';

const code = (w: PairedWorld, bytes: Uint8Array): RedeemFailureCode | 'OK' => {
  const r = w.redeemerSvc.validate(bytes);
  return r.ok ? 'OK' : r.code;
};

describe('rejections', () => {
  it('accepts a crafted voucher (control case)', async () => {
    const w = await makePairedWorld();
    expect(code(w, craftVoucher(w))).toBe('OK');
  });

  it('rejects a voucher addressed to a different Redeemer', async () => {
    const a = await makePairedWorld();
    const b = await makePairedWorld();
    expect(code(b, craftVoucher(a))).toBe('WRONG_REDEEMER');
  });

  it('rejects a wrong installation identifier', async () => {
    const w = await makePairedWorld();
    const real = w.issuer.identifier()!;
    const wrong = real === 'AAA' ? 'BBB' : 'AAA';
    expect(code(w, craftVoucher(w, { installationIdentifier: wrong }))).toBe('WRONG_INSTALLATION_ID');
  });

  it('rejects a wrong rolling date code', async () => {
    const w = await makePairedWorld();
    const codes = w.issuer.rollingCodes()!;
    const other = ['daisy', 'river', 'amber'].find((x) => x !== codes['10-03'])!;
    expect(code(w, craftVoucher(w, { rollingDateCode: other }))).toBe('INVALID_ROLLING_CODE');
  });

  it('rejects a voucher whose date does not match its rolling code', async () => {
    const w = await makePairedWorld();
    const codes = w.issuer.rollingCodes()!;
    const forgedDate = { dateCreated: '2026-03-11', createdAt: '2026-03-11T10:30:45.000Z', timeCreated: '10:30:45' };
    expect(codes['11-03']).not.toBe(codes['10-03']);
    expect(code(w, craftVoucher(w, { ...forgedDate, rollingDateCode: codes['10-03'] }))).toBe('INVALID_ROLLING_CODE');
  });

  it('rejects an invalid Issuer signature', async () => {
    const w = await makePairedWorld();
    const rogue = await generateRsaKeyPair();
    expect(code(w, craftVoucher(w, {}, { issuerPrivateKeyDer: rogue.privateKeyDer }))).toBe('INVALID_SIGNATURE');
  });

  it('rejects modified signed data even when re-encrypted for the Redeemer', async () => {
    const w = await makePairedWorld();
    const original = w.issuerSvc.createVoucher({ fullName: 'A B', amount: '4' }, { allowCustomAmount: false });
    // Attacker knows the Redeemer public key: change the amount, keep a signature made with another key.
    const rogue = await generateRsaKeyPair();
    const payload = original.payload;
    const forgedPlain = Buffer.concat([
      encodeVoucherPayload({ ...payload, amountPence: 99_999 }),
      signData(rogue.privateKeyDer, signedBytesOf(payload)),
    ]);
    const env = encryptEnvelope({ type: 'voucher', recipientPublicKeyDer: w.redeemer.publicKeyDer(), plaintext: forgedPlain, compress: false });
    expect(code(w, encodeEnvelope(env))).toBe('INVALID_SIGNATURE');
  });

  it('rejects modified ciphertext as altered data', async () => {
    const w = await makePairedWorld();
    const bytes = Buffer.from(craftVoucher(w));
    bytes[bytes.length - 5] = bytes[bytes.length - 5]! ^ 1;
    expect(code(w, bytes)).toBe('DATA_ALTERED');
  });

  it('rejects corrupted or truncated barcodes and foreign content', async () => {
    const w = await makePairedWorld();
    const bytes = craftVoucher(w);
    expect(code(w, bytes.subarray(0, 200))).toBe('CORRUPTED_BARCODE');
    expect(code(w, Buffer.from('https://example.com/not-a-voucher'))).toBe('INVALID_STRUCTURE');
    expect(code(w, randomBytes(900))).toBe('INVALID_STRUCTURE');
    expect(code(w, Buffer.alloc(0))).toBe('INVALID_STRUCTURE');
    const wrongKey = Buffer.from(bytes);
    wrongKey[6] = wrongKey[6]! ^ 0xff;
    expect(code(w, wrongKey)).toBe('WRONG_REDEEMER');
    const wrapped = Buffer.from(bytes);
    wrapped[100] = wrapped[100]! ^ 0xff;
    expect(code(w, wrapped)).toBe('UNABLE_TO_DECRYPT');
  });

  it('rejects unsupported envelope and payload versions', async () => {
    const w = await makePairedWorld();
    const bytes = Buffer.from(craftVoucher(w));
    const v2 = Buffer.from(bytes);
    v2[2] = 2;
    expect(code(w, v2)).toBe('UNSUPPORTED_VERSION');

    const parts = decodeEnvelope(bytes);
    expect(parts.type).toBe('voucher');
    const payloadBytes = Buffer.from(encodeVoucherPayload(w.issuerSvc.createVoucher({ fullName: 'A B', amount: '4' }, { allowCustomAmount: false }).payload));
    payloadBytes[0] = 2;
    const env = encryptEnvelope({
      type: 'voucher',
      recipientPublicKeyDer: w.redeemer.publicKeyDer(),
      plaintext: Buffer.concat([payloadBytes, randomBytes(384)]),
      compress: false,
    });
    expect(code(w, encodeEnvelope(env))).toBe('UNSUPPORTED_VERSION');
  });

  it('rejects an envelope of the wrong type', async () => {
    const w = await makePairedWorld();
    const env = encryptEnvelope({ type: 'setup-response', recipientPublicKeyDer: w.redeemer.publicKeyDer(), plaintext: randomBytes(32), compress: false });
    expect(code(w, encodeEnvelope(env))).toBe('INVALID_STRUCTURE');
  });
});

describe('time rules', () => {
  it('rejects vouchers created in the future beyond tolerance', async () => {
    const w = await makePairedWorld();
    const ts = new Date(w.clock.now.getTime() + FUTURE_TOLERANCE_MS + 60_000);
    const iso = ts.toISOString();
    const codes = w.issuer.rollingCodes()!;
    const key = `${iso.slice(8, 10)}-${iso.slice(5, 7)}`;
    const bytes = craftVoucher(w, {
      rollingDateCode: codes[key],
      dateCreated: iso.slice(0, 10),
      timeCreated: iso.slice(11, 19),
      createdAt: iso,
    });
    expect(code(w, bytes)).toBe('FUTURE_DATE');
    const ok = new Date(w.clock.now.getTime() + FUTURE_TOLERANCE_MS - 1000).toISOString();
    expect(
      code(w, craftVoucher(w, { rollingDateCode: codes[`${ok.slice(8, 10)}-${ok.slice(5, 7)}`], dateCreated: ok.slice(0, 10), timeCreated: ok.slice(11, 19), createdAt: ok })),
    ).toBe('OK');
  });

  it('enforces global expiry exactly at the boundary', async () => {
    const w = await makePairedWorld();
    const voucher = craftVoucher(w);
    w.redeemerSvc.setExpiry('2026-03-10T10:30:45.000Z', 'Europe/London');
    expect(code(w, voucher)).toBe('OK');
    w.clock.now = new Date('2026-03-10T10:30:45.001Z');
    expect(code(w, voucher)).toBe('EXPIRED');
  });

  it('applies expiry changes immediately and records them in the audit log', async () => {
    const w = await makePairedWorld();
    const v = craftVoucher(w);
    w.redeemerSvc.setExpiry('2026-03-10T10:00:00.000Z', 'Europe/London');
    expect(code(w, v)).toBe('EXPIRED');
    w.redeemerSvc.setExpiry('2026-12-31T23:59:59.000Z', 'Europe/London');
    expect(code(w, v)).toBe('OK');
    const events = w.redeemer.audit.list(50).filter((e) => e.eventType === 'EXPIRY_CHANGED');
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(() => w.redeemerSvc.setExpiry('nonsense', 'Europe/London')).toThrow(ExpiryError);
    expect(() => w.redeemerSvc.setExpiry('2026-12-31T23:59:59.000Z', 'Mars/Phobos')).toThrow(ExpiryError);
  });

  it('refuses redemption until an expiry is configured', async () => {
    const w = await makePairedWorld();
    w.redeemer.settings.delete('redeemer.expiry');
    expect(code(w, craftVoucher(w))).toBe('EXPIRY_NOT_CONFIGURED');
  });

  it('re-checks expiry at confirmation time', async () => {
    const w = await makePairedWorld();
    w.redeemerSvc.setExpiry('2026-03-10T10:31:00.000Z', 'Europe/London');
    const r = w.redeemerSvc.validate(craftVoucher(w));
    if (!r.ok) throw new Error('expected valid');
    w.clock.now = new Date('2026-03-10T10:32:00.000Z');
    expect(w.redeemerSvc.confirm(r.ticketId)).toEqual({ ok: false, code: 'EXPIRED' });
    expect(w.redeemerSvc.history('', 'asc')).toHaveLength(0);
  });

  it('detects clock rollback, latches the block and needs administrator resolution', async () => {
    const w = await makePairedWorld();
    const v = craftVoucher(w);
    expect(code(w, v)).toBe('OK');
    w.clock.now = new Date(w.clock.now.getTime() - CLOCK_ROLLBACK_TOLERANCE_MS + 1000);
    expect(code(w, v)).toBe('OK');
    w.clock.now = new Date(w.clock.now.getTime() - 10 * 60_000);
    expect(code(w, v)).toBe('CLOCK_INTEGRITY');
    expect(w.redeemer.clockBlocked()).toBe(true);
    w.clock.now = new Date(w.clock.now.getTime() + 60 * 60_000);
    expect(code(w, v)).toBe('CLOCK_INTEGRITY');
    expect(w.redeemer.audit.list(50).some((e) => e.eventType === 'CLOCK_ROLLBACK_DETECTED')).toBe(true);
    w.redeemerSvc.resolveClockWarning();
    expect(w.redeemer.clockBlocked()).toBe(false);
    expect(code(w, craftVoucher(w))).toBe('OK');
    expect(w.redeemer.audit.list(50).some((e) => e.eventType === 'CLOCK_WARNING_RESOLVED')).toBe(true);
  });
});
