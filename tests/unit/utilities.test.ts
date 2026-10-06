import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../../src/shared/utilities/canonicalJson';
import { fromBase64Url, isBase64Url, toBase64Url } from '../../src/shared/utilities/base64';
import { formatPence, parseGbpToPence } from '../../src/shared/utilities/money';
import {
  allRollingDateKeys,
  formatUkDate,
  isValidIsoDate,
  localTimestampFrom,
  rollingKeyFromIsoDate,
} from '../../src/shared/utilities/dates';
import { voucherPayloadSchema } from '../../src/shared/schemas/protocol';
import { ROLLING_WORDS } from '../../src/main/pairing/wordlist';
import { generateRollingDateCodes } from '../../src/main/pairing/rollingCodes';
import { decodeVoucherPayload, encodeVoucherPayload } from '../../src/main/vouchers/payloadCodec';

describe('money', () => {
  it('parses pounds into integer pence', () => {
    expect(parseGbpToPence('4')).toEqual({ ok: true, pence: 400 });
    expect(parseGbpToPence('4.5')).toEqual({ ok: true, pence: 450 });
    expect(parseGbpToPence('£4.00')).toEqual({ ok: true, pence: 400 });
    expect(parseGbpToPence('0.01')).toEqual({ ok: true, pence: 1 });
    expect(parseGbpToPence('19.99')).toEqual({ ok: true, pence: 1999 });
  });

  it('rejects zero, negative, excess precision and junk', () => {
    for (const bad of ['0', '0.00', '-1', '4.001', 'abc', '', '1e3', '1,000', '99999999']) {
      expect(parseGbpToPence(bad).ok).toBe(false);
    }
  });

  it('formats pence as GBP', () => {
    expect(formatPence(400)).toBe('£4.00');
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(123456)).toBe('£1,234.56');
  });
});

describe('dates and rolling keys', () => {
  it('includes all 366 DD-MM keys with 29-02 and no invalid dates', () => {
    const keys = allRollingDateKeys();
    expect(keys).toHaveLength(366);
    expect(new Set(keys).size).toBe(366);
    expect(keys).toContain('29-02');
    expect(keys).not.toContain('30-02');
    expect(keys).not.toContain('31-04');
    expect(keys[0]).toBe('01-01');
    expect(keys[keys.length - 1]).toBe('31-12');
  });

  it('handles 29 February and calendar validity', () => {
    expect(rollingKeyFromIsoDate('2028-02-29')).toBe('29-02');
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(() => rollingKeyFromIsoDate('2027-02-29')).toThrow();
    expect(formatUkDate('2026-01-05')).toBe('05/01/2026');
  });

  it('builds local timestamps with offsets', () => {
    const t = localTimestampFrom(Date.UTC(2026, 0, 1, 23, 30, 0), 120);
    expect(t.date).toBe('2026-01-02');
    expect(t.time).toBe('01:30:00');
    expect(t.iso).toBe('2026-01-02T01:30:00.000+02:00');
    expect(localTimestampFrom(0, 0).iso).toBe('1970-01-01T00:00:00.000Z');
  });

  it('generates 366 unique rolling words', () => {
    expect(new Set(ROLLING_WORDS).size).toBeGreaterThanOrEqual(366);
    for (const w of ROLLING_WORDS) expect(w).toMatch(/^[a-z]{3,12}$/);
    const codes = generateRollingDateCodes();
    expect(Object.keys(codes)).toHaveLength(366);
    expect(new Set(Object.values(codes)).size).toBe(366);
    expect(codes['29-02']).toBeTruthy();
  });
});

describe('encoding helpers', () => {
  it('round-trips base64url and rejects invalid input', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => i % 256);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    expect(isBase64Url('abc+')).toBe(false);
    expect(isBase64Url('a')).toBe(false);
    expect(() => fromBase64Url('abc=')).toThrow();
  });

  it('canonicalises JSON deterministically', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe('{"a":[2,{"c":2,"d":1}],"b":1}');
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson({ a: NaN })).toThrow();
  });
});

describe('voucher payload schema and codec', () => {
  const valid = {
    type: 'voucher',
    version: 1,
    voucherId: '9dfdc878-ca62-4cd3-a682-4539b20ec727',
    fullName: 'Example Person',
    amountPence: 400,
    currency: 'GBP',
    rollingDateCode: 'daisy',
    dateCreated: '2026-01-01',
    timeCreated: '10:30:45',
    createdAt: '2026-01-01T10:30:45.000Z',
    installationIdentifier: 'ABC',
  };

  it('accepts a valid payload and survives the compact codec', () => {
    const p = voucherPayloadSchema.parse(valid);
    expect(decodeVoucherPayload(encodeVoucherPayload(p))).toEqual(p);
    const offset = voucherPayloadSchema.parse({ ...valid, dateCreated: '2026-01-01', timeCreated: '11:30:45', createdAt: '2026-01-01T11:30:45.000+01:00' });
    expect(decodeVoucherPayload(encodeVoucherPayload(offset))).toEqual(offset);
    const unicode = voucherPayloadSchema.parse({ ...valid, fullName: 'Zoë Ó’Brien' });
    expect(decodeVoucherPayload(encodeVoucherPayload(unicode)).fullName).toBe('Zoë Ó’Brien');
  });

  it('rejects invalid fields and unknown keys', () => {
    const bad = (patch: Record<string, unknown>) => voucherPayloadSchema.safeParse({ ...valid, ...patch }).success;
    expect(bad({})).toBe(true);
    expect(bad({ voucherId: 'not-a-uuid' })).toBe(false);
    expect(bad({ voucherId: '9dfdc878-ca62-1cd3-a682-4539b20ec727' })).toBe(false);
    expect(bad({ amountPence: 0 })).toBe(false);
    expect(bad({ amountPence: -5 })).toBe(false);
    expect(bad({ amountPence: 4.5 })).toBe(false);
    expect(bad({ currency: 'USD' })).toBe(false);
    expect(bad({ version: 2 })).toBe(false);
    expect(bad({ dateCreated: '2027-02-29', createdAt: '2027-02-29T10:30:45.000Z' })).toBe(false);
    expect(bad({ installationIdentifier: 'abc' })).toBe(false);
    expect(bad({ fullName: 'Bad\u0000Name' })).toBe(false);
    expect(bad({ fullName: 'x'.repeat(61) })).toBe(false);
    expect(bad({ fullName: '   ' })).toBe(false);
    expect(bad({ timeCreated: '10:30:46' })).toBe(false);
    expect(bad({ extra: true })).toBe(false);
  });
});
