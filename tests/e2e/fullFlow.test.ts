import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { encodePdf417, matrixToRgba } from '../../src/main/pdf/barcode';
import { DEFAULT_BRANDING, renderVoucherPdf } from '../../src/main/pdf/voucherPdf';
import { IssuerService } from '../../src/main/services/issuerService';
import { RedeemerService } from '../../src/main/services/redeemerService';
import { ADMIN_PASSWORD, FONTS_DIR, makeInstallation, type Clock } from '../helpers/fixtures';
import { decodePdf417 } from '../helpers/decode';
import { bytesToDigits } from '../../src/shared/utilities/numeric';

/** Simulates showing a text PDF417 on screen and scanning it back. */
async function scanText(text: string): Promise<Buffer> {
  const columns = text.length > 600 ? 14 : 10;
  const raster = matrixToRgba(encodePdf417(text, { columns, eclevel: 4 }), 3);
  const decoded = await decodePdf417(raster);
  if (!decoded) throw new Error('barcode could not be decoded');
  return decoded;
}

describe('end-to-end development flow (never included in production builds)', () => {
  it('pairs over PDF417, issues a £4.00 voucher PDF, redeems it once and rejects the second attempt', async () => {
    const clock: Clock = { now: new Date('2026-09-01T09:15:30.000Z') };
    const issuerInst = makeInstallation(clock);
    const redeemerInst = makeInstallation(clock);

    // 1-2. Create installations.
    await issuerInst.setup('issuer', ADMIN_PASSWORD);
    await redeemerInst.setup('redeemer', ADMIN_PASSWORD);
    const issuer = new IssuerService(issuerInst);
    const redeemer = new RedeemerService(redeemerInst);

    // 3. Simulated PDF417 pairing, in both directions, with parts scanned out of order.
    const requestScan = await scanText(issuer.pairingRequestText());
    const { parts } = await redeemer.acceptPairingRequest(requestScan);
    expect(parts.length).toBeGreaterThan(1);
    const order = [...parts.keys()].reverse();
    let last;
    for (const i of order) last = issuer.submitSetupPart(await scanText(parts[i]!));
    expect(last?.paired).toBe(true);
    expect(issuerInst.pairingState()).toBe('paired');
    expect(redeemerInst.pairingState()).toBe('paired');
    redeemer.setExpiry('2027-07-31T22:59:59.000Z', 'Europe/London');

    // 4. Create a £4.00 voucher.
    const voucher = issuer.createVoucher({ fullName: 'Alex Example', amount: '4.00' }, { allowCustomAmount: false });
    expect(voucher.payload.amountPence).toBe(400);

    // 5. Generate its PDF.
    const pdf = await renderVoucherPdf({
      branding: DEFAULT_BRANDING,
      fullName: voucher.payload.fullName,
      amountPence: voucher.payload.amountPence,
      dateCreatedIso: voucher.payload.dateCreated,
        barcodeInput: bytesToDigits(voucher.barcodeBytes),
      fontsDir: FONTS_DIR,
    });
    expect(Buffer.from(pdf.pdf).subarray(0, 5).toString()).toBe('%PDF-');
    const doc = await PDFDocument.load(pdf.pdf);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBeCloseTo((85.6 / 25.4) * 72, 1);
    expect(height).toBeCloseTo((54 / 25.4) * 72, 1);

    // 6. Decode the exact symbol that was drawn, rasterised at roughly 300 dpi.
    const scale = Math.max(3, Math.round((pdf.xDimensionMm / 25.4) * 300));
    const decoded = await decodePdf417(matrixToRgba(pdf.matrix, scale, { rowHeight: pdf.rowHeight, quiet: 4 }));
    expect(decoded).not.toBeNull();
    expect(decoded!.toString('latin1')).toBe(bytesToDigits(voucher.barcodeBytes));

    // 7. Redeem successfully.
    clock.now = new Date('2026-09-01T09:20:00.000Z');
    const first = redeemer.validateScan(decoded!);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.voucher.fullName).toBe('Alex Example');
    expect(first.voucher.amountDisplay).toBe('£4.00');
    const redeemed = redeemer.confirm(first.ticketId);
    expect(redeemed.ok).toBe(true);

    // 8-9. A second attempt is rejected.
    expect(redeemer.validateScan(decoded!)).toEqual({ ok: false, code: 'ALREADY_REDEEMED' });
    expect(redeemer.history('', 'desc')).toHaveLength(1);
  });
});
