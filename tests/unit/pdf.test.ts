import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { randomBytes } from 'node:crypto';
import { VOUCHER_LAYOUTS, type VoucherLayoutId } from '../../src/shared/constants/index';
import { matrixToRgba } from '../../src/main/pdf/barcode';
import { bytesToDigits } from '../../src/shared/utilities/numeric';
import { DEFAULT_BRANDING, LayoutError, planBarcode, renderVoucherPdf } from '../../src/main/pdf/voucherPdf';
import { FONTS_DIR } from '../helpers/fixtures';
import { decodePdf417 } from '../helpers/decode';

// 1x1 transparent PNG.
const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const render = (layout: VoucherLayoutId, name: string, bytes: string, extra = {}) =>
  renderVoucherPdf({
    branding: { ...DEFAULT_BRANDING, layout, ...extra },
    fullName: name,
    amountPence: 400,
    dateCreatedIso: '2026-01-01',
    barcodeInput: bytes,
    fontsDir: FONTS_DIR,
  });

describe('voucher PDF', () => {
  const voucherSized = bytesToDigits(randomBytes(955));

  for (const layout of Object.keys(VOUCHER_LAYOUTS) as VoucherLayoutId[]) {
    it(`renders a decodable, undistorted barcode on the ${layout} layout`, async () => {
      const r = await render(layout, 'Alex Example', voucherSized);
      const spec = VOUCHER_LAYOUTS[layout];
      const doc = await PDFDocument.load(r.pdf);
      expect(doc.getPage(0).getSize().width).toBeCloseTo((spec.widthMm / 25.4) * 72, 1);
      expect(r.xDimensionMm).toBeGreaterThanOrEqual(0.19);
      const decoded = await decodePdf417(matrixToRgba(r.matrix, 3, { rowHeight: r.rowHeight, quiet: 4 }));
      expect(decoded?.toString('latin1')).toBe(voucherSized);
    });
  }

  it('handles very long names, unsupported characters and an embedded logo', async () => {
    const r = await render('wallet', 'W'.repeat(60), voucherSized, {
      organisationName: 'O'.repeat(60),
      logo: { mime: 'image/png', base64: PNG_1PX },
    });
    expect(r.pdf.length).toBeGreaterThan(1000);
    const cjk = await render('a6', '山田 太郎 Ωmega', voucherSized);
    expect(cjk.pdf.length).toBeGreaterThan(1000);
  });

  it('does not place personal data or keys in document metadata', async () => {
    const r = await render('a6', 'Secret Name', voucherSized);
    const doc = await PDFDocument.load(r.pdf);
    expect(doc.getTitle()).toBe('Voucher');
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.getKeywords()).toBeUndefined();
  });

  it('refuses a layout that is too small for a reliable barcode', () => {
    expect(() => planBarcode(voucherSized, 30, 12, 3)).toThrow(LayoutError);
  });
});
