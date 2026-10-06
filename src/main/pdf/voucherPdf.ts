import { PDFDocument, rgb, type PDFFont, type PDFImage, type RGB } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VOUCHER_LAYOUTS, type VoucherLayoutId } from '../../shared/constants/index';
import type { BrandingConfig } from '../../shared/types/api';
import { formatPence } from '../../shared/utilities/money';
import { formatUkDate } from '../../shared/utilities/dates';
import { encodePdf417, type Pdf417Matrix } from './barcode';

const PT_PER_MM = 72 / 25.4;
const MIN_XDIM_MM = 0.19;
const EC_LEVEL = 4;
const QUIET_MODULES = 4;

/** Row height in modules. The wallet card needs 2:1 rows to keep the module width scannable. */
const ROW_HEIGHT: Record<VoucherLayoutId, number> = { wallet: 2, a6: 3, a5: 3 };

export const DEFAULT_BRANDING: BrandingConfig = {
  organisationName: 'Your Organisation',
  primaryColour: '#1f4e79',
  secondaryColour: '#f2a900',
  textColour: '#1b1b1b',
  footerText: 'Present this voucher for redemption.',
  layout: 'wallet',
  logo: null,
};

export class LayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LayoutError';
  }
}

export interface BarcodePlan {
  matrix: Pdf417Matrix;
  rowHeight: number;
  /** Width of one module in millimetres once placed. */
  xDimensionMm: number;
}

/** Picks the column count that gives the widest modules inside the available area. */
export function planBarcode(input: Uint8Array | string, areaWidthMm: number, areaHeightMm: number, rowHeight: number): BarcodePlan {
  let best: BarcodePlan | null = null;
  for (let columns = 6; columns <= 28; columns++) {
    let matrix: Pdf417Matrix;
    try {
      matrix = encodePdf417(input, { columns, eclevel: EC_LEVEL });
    } catch {
      continue;
    }
    const wModules = matrix.cols + 2 * QUIET_MODULES;
    const hModules = matrix.rows * rowHeight + 2 * QUIET_MODULES;
    const x = Math.min(areaWidthMm / wModules, areaHeightMm / hModules);
    if (!best || x > best.xDimensionMm) best = { matrix, rowHeight, xDimensionMm: x };
  }
  if (!best) throw new LayoutError('The barcode could not be encoded');
  if (best.xDimensionMm < MIN_XDIM_MM) {
    throw new LayoutError('This voucher layout is too small for a reliable barcode. Choose a larger layout in Administration.');
  }
  return best;
}

function hex(c: string): RGB {
  const n = parseInt(c.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function isDark(c: string): boolean {
  const n = parseInt(c.slice(1), 16);
  const lum = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return lum < 140;
}

function printable(font: PDFFont, text: string): string {
  const set = new Set(font.getCharacterSet());
  return [...text].map((ch) => (set.has(ch.codePointAt(0)!) ? ch : '?')).join('');
}

/** Shrinks to fit, then truncates with an ellipsis as a last resort. */
function fit(font: PDFFont, text: string, maxWidth: number, size: number, minSize: number): { text: string; size: number } {
  let s = size;
  while (s > minSize && font.widthOfTextAtSize(text, s) > maxWidth) s -= 0.25;
  if (font.widthOfTextAtSize(text, s) <= maxWidth) return { text, size: s };
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, s) > maxWidth) t = t.slice(0, -1);
  return { text: `${t.trimEnd()}…`, size: s };
}

export interface VoucherPdfInput {
  branding: BrandingConfig;
  fullName: string;
  amountPence: number;
  dateCreatedIso: string;
  /** Binary voucher envelope, or text for a test page. */
  barcodeInput: Uint8Array | string;
  fontsDir: string;
}

export interface VoucherPdfResult {
  pdf: Uint8Array;
  xDimensionMm: number;
  /** The exact symbol drawn on the page, for on-screen previews and decode tests. */
  matrix: Pdf417Matrix;
  rowHeight: number;
}

export async function renderVoucherPdf(input: VoucherPdfInput): Promise<VoucherPdfResult> {
  const b = input.branding;
  const layout = VOUCHER_LAYOUTS[b.layout];
  const W = layout.widthMm;
  const H = layout.heightMm;
  const k = H / 54;
  const margin = 2.5 * k;
  const headerH = 0.15 * H;
  const infoH = 0.19 * H;
  const footerH = b.footerText.trim() ? 0.07 * H : 0;

  const barcodeTop = headerH + margin * 0.6 + infoH;
  const barcodeBottom = H - footerH - margin * 0.4;
  const areaW = W - 2 * margin;
  const areaH = barcodeBottom - barcodeTop;
  const plan = planBarcode(input.barcodeInput, areaW, areaH, ROW_HEIGHT[b.layout]);

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle('Voucher');
  doc.setCreator('Voucher Redeem');
  doc.setProducer('Voucher Redeem');
  const regular = await doc.embedFont(readFileSync(join(input.fontsDir, 'NotoSans-Regular.woff')), { subset: true });
  const bold = await doc.embedFont(readFileSync(join(input.fontsDir, 'NotoSans-Bold.woff')), { subset: true });

  const page = doc.addPage([W * PT_PER_MM, H * PT_PER_MM]);
  const mm = (v: number): number => v * PT_PER_MM;
  const yTop = (fromTop: number): number => mm(H - fromTop);

  const textColour = hex(b.textColour);
  page.drawRectangle({ x: 0, y: 0, width: mm(W), height: mm(H), color: rgb(1, 1, 1) });

  // Header band and accent strip.
  page.drawRectangle({ x: 0, y: yTop(headerH), width: mm(W), height: mm(headerH), color: hex(b.primaryColour) });
  page.drawRectangle({ x: 0, y: yTop(headerH + 0.8 * k), width: mm(W), height: mm(0.8 * k), color: hex(b.secondaryColour) });

  let logo: PDFImage | null = null;
  if (b.logo) {
    const bytes = Buffer.from(b.logo.base64, 'base64');
    logo = b.logo.mime === 'image/png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  }
  let logoWidthMm = 0;
  if (logo) {
    const ratio = logo.width / logo.height;
    const lh = Math.min(headerH - 2 * k, (W * 0.3) / ratio);
    const lw = lh * ratio;
    logoWidthMm = lw + margin;
    page.drawImage(logo, { x: mm(W - margin - lw), y: yTop((headerH + lh) / 2), width: mm(lw), height: mm(lh) });
  }
  const headerText = isDark(b.primaryColour) ? rgb(1, 1, 1) : rgb(0.05, 0.05, 0.05);
  const org = fit(bold, printable(bold, b.organisationName), mm(W - 2 * margin - logoWidthMm), 11 * k, 6);
  page.drawText(org.text, { x: mm(margin), y: yTop(headerH / 2) - org.size * 0.35, size: org.size, font: bold, color: headerText });

  // Name, date and amount.
  const infoTop = headerH + margin * 0.6;
  const name = fit(bold, printable(bold, input.fullName), mm(areaW), 11 * k, 6);
  page.drawText(name.text, { x: mm(margin), y: yTop(infoTop) - name.size, size: name.size, font: bold, color: textColour });
  const amountText = formatPence(input.amountPence);
  const amount = fit(bold, amountText, mm(areaW * 0.5), 17 * k, 8);
  const amountW = bold.widthOfTextAtSize(amount.text, amount.size);
  const lineTwoBaseline = yTop(infoTop + infoH) + 1.2 * PT_PER_MM;
  page.drawText(amount.text, { x: mm(W - margin) - amountW, y: lineTwoBaseline, size: amount.size, font: bold, color: textColour });
  const dateLabel = fit(regular, `Created ${formatUkDate(input.dateCreatedIso)}`, mm(areaW - 2) - amountW, 8 * k, 5);
  page.drawText(dateLabel.text, { x: mm(margin), y: lineTwoBaseline, size: dateLabel.size, font: regular, color: textColour });

  // Barcode: vector modules centred in its area, on a white quiet zone.
  const { matrix, rowHeight, xDimensionMm } = plan;
  const wMm = (matrix.cols + 2 * QUIET_MODULES) * xDimensionMm;
  const hMm = (matrix.rows * rowHeight + 2 * QUIET_MODULES) * xDimensionMm;
  const left = margin + (areaW - wMm) / 2;
  const top = barcodeTop + (areaH - hMm) / 2;
  const x0 = mm(left + QUIET_MODULES * xDimensionMm);
  const y0 = H - top - QUIET_MODULES * xDimensionMm;
  const mod = mm(xDimensionMm);
  const black = rgb(0, 0, 0);
  for (let r = 0; r < matrix.rows; r++) {
    let c = 0;
    while (c < matrix.cols) {
      if (matrix.data[r * matrix.cols + c] !== 1) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < matrix.cols && matrix.data[r * matrix.cols + c + run] === 1) run++;
      page.drawRectangle({
        x: x0 + c * mod,
        y: mm(y0) - (r + 1) * rowHeight * mod,
        width: run * mod,
        height: rowHeight * mod + mod * 0.03,
        color: black,
        borderWidth: 0,
      });
      c += run;
    }
  }

  if (footerH > 0) {
    const f = fit(regular, printable(regular, b.footerText), mm(areaW), 6.5 * k, 4);
    const w = regular.widthOfTextAtSize(f.text, f.size);
    page.drawText(f.text, { x: (mm(W) - w) / 2, y: mm(margin * 0.5) + 1, size: f.size, font: regular, color: textColour });
  }

  return { pdf: await doc.save(), xDimensionMm, matrix, rowHeight };
}
