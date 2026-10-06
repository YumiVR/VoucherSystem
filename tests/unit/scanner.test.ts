import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { bytesToDigits, digitsToBytes } from '../../src/shared/utilities/numeric';
import { WedgeParser, type WedgeConfig, type WedgeEvent } from '../../src/shared/utilities/wedgeParser';
import { encodePdf417, matrixToRgba } from '../../src/main/pdf/barcode';
import { makePairedWorld } from '../helpers/fixtures';
import { decodePdf417 } from '../helpers/decode';

describe('numeric voucher barcode text', () => {
  it('round-trips arbitrary bytes, including leading zeros', () => {
    for (const bytes of [randomBytes(860), Uint8Array.from([0, 0, 1]), Uint8Array.from([0]), new Uint8Array(0)]) {
      expect(digitsToBytes(bytesToDigits(bytes))).toEqual(new Uint8Array(bytes));
    }
  });

  it('rejects text that is not a valid encoding', () => {
    expect(digitsToBytes('')).toBeNull();
    expect(digitsToBytes('12ab')).toBeNull();
    expect(digitsToBytes('9'.repeat(20))).toBeNull();
    expect(digitsToBytes('1'.repeat(4000))).toBeNull();
  });

  it('fits one PDF417 and decodes back through the real decoder', async () => {
    const digits = bytesToDigits(randomBytes(955));
    const m = encodePdf417(digits, { columns: 20, eclevel: 4 });
    const decoded = await decodePdf417(matrixToRgba(m, 3));
    expect(decoded?.toString('latin1')).toBe(digits);
  });
});

function feed(parser: WedgeParser, text: string, start: number, gap: number, terminator?: string): { events: WedgeEvent[]; consumed: number; end: number } {
  const events: WedgeEvent[] = [];
  let t = start;
  let consumed = 0;
  for (const ch of text) {
    const r = parser.pushKey(ch, t);
    if (r.consumed) consumed++;
    if (r.event) events.push(r.event);
    t += gap;
  }
  if (terminator) {
    const r = parser.pushKey(terminator, t);
    if (r.consumed) consumed++;
    if (r.event) events.push(r.event);
  }
  return { events, consumed, end: t };
}

const cfg = (c: Partial<WedgeConfig> = {}): WedgeConfig => ({ prefix: '', suffix: '', terminator: 'enter', ...c });

describe('keyboard-wedge parser', () => {
  it('buffers fast input and completes on Enter', () => {
    const p = new WedgeParser(cfg());
    const { events } = feed(p, '123456789012', 0, 3, 'Enter');
    expect(events).toEqual([{ kind: 'scan', text: '123456789012', raw: '123456789012' }]);
  });

  it('completes on carriage return and on Tab when configured', () => {
    expect(feed(new WedgeParser(cfg()), 'ABCDEFGHIJ', 0, 2, '\r').events[0]?.kind).toBe('scan');
    expect(feed(new WedgeParser(cfg({ terminator: 'tab' })), 'ABCDEFGHIJ', 0, 2, 'Tab').events[0]?.kind).toBe('scan');
    expect(feed(new WedgeParser(cfg({ terminator: 'tab' })), 'ABCDEFGHIJ', 0, 2, 'Enter').events).toEqual([]);
  });

  it('ignores human typing and lets Enter through', () => {
    const p = new WedgeParser(cfg());
    const typed = feed(p, 'hello world', 0, 180, 'Enter');
    expect(typed.events).toEqual([]);
    expect(typed.consumed).toBe(0);
  });

  it('does not swallow a short fast burst such as a quick typist', () => {
    const p = new WedgeParser(cfg());
    expect(feed(p, 'abc', 0, 5, 'Enter').events).toEqual([]);
  });

  it('strips configured prefix and suffix and rejects scans without them', () => {
    const p = new WedgeParser(cfg({ prefix: '~', suffix: '#' }));
    expect(feed(p, '~PAYLOAD12345#', 0, 2, 'Enter').events[0]).toMatchObject({ kind: 'scan', text: 'PAYLOAD12345' });
    expect(feed(p, 'PAYLOAD12345#', 5000, 2, 'Enter').events[0]).toMatchObject({ kind: 'rejected', reason: 'prefix' });
    expect(feed(p, '~PAYLOAD12345', 9000, 2, 'Enter').events[0]).toMatchObject({ kind: 'rejected', reason: 'suffix' });
  });

  it('rejects incomplete scans (no terminator) after the idle time', () => {
    const p = new WedgeParser(cfg());
    const { end } = feed(p, '1234567890', 0, 2);
    expect(p.tick(end + 10)).toBeUndefined();
    expect(p.tick(end + 400)).toMatchObject({ kind: 'rejected', reason: 'incomplete' });
    expect(p.tick(end + 800)).toBeUndefined();
  });

  it('rejects a scan interrupted by a long pause', () => {
    const p = new WedgeParser(cfg());
    const a = feed(p, '12345678', 0, 2);
    const b = feed(p, '9', a.end + 500, 2, 'Enter');
    expect(b.events[0]).toMatchObject({ kind: 'rejected', reason: 'incomplete' });
  });

  it('completes on idle when no terminator is configured', () => {
    const p = new WedgeParser(cfg({ terminator: 'none' }));
    const { end } = feed(p, '1234567890', 0, 2);
    expect(p.tick(end + 400)).toMatchObject({ kind: 'scan', text: '1234567890' });
  });

  it('ignores the same barcode scanned again within the duplicate window', () => {
    const p = new WedgeParser(cfg());
    expect(feed(p, '1234567890', 0, 2, 'Enter').events[0]?.kind).toBe('scan');
    expect(feed(p, '1234567890', 500, 2, 'Enter').events[0]).toMatchObject({ kind: 'rejected', reason: 'duplicate' });
    expect(feed(p, '1234567890', 5000, 2, 'Enter').events[0]?.kind).toBe('scan');
  });

  it('delivers a real voucher typed by a scanner to the Redeemer for validation', async () => {
    const w = await makePairedWorld();
    const v = w.issuerSvc.createVoucher({ fullName: 'Wedge Person', amount: '4' }, { allowCustomAmount: false });
    const p = new WedgeParser(cfg());
    const { events } = feed(p, bytesToDigits(v.barcodeBytes), 0, 1, 'Enter');
    const ev = events[0];
    expect(ev?.kind).toBe('scan');
    if (ev?.kind !== 'scan') return;
    const first = w.redeemerSvc.validateScan(Buffer.from(ev.text, 'latin1'));
    expect(first.ok).toBe(true);
    expect(w.redeemerSvc.validateScan(Buffer.from('not a voucher'))).toEqual({ ok: false, code: 'INVALID_STRUCTURE' });
    expect(w.redeemerSvc.validateScan(Buffer.from('12345678901234567890'))).toEqual({ ok: false, code: 'CORRUPTED_BARCODE' });
  });
});
