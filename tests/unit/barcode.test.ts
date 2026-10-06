import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encodePdf417, matrixToRgba } from '../../src/main/pdf/barcode';
import { decodePdf417 } from '../helpers/decode';

describe('PDF417 encoding', () => {
  it('round-trips a ~960 byte binary payload at various column counts', async () => {
    const payload = randomBytes(960);
    for (const columns of [10, 14, 18]) {
      const m = encodePdf417(payload, { columns, eclevel: 4 });
      const decoded = await decodePdf417(matrixToRgba(m, 3));
      expect(decoded?.equals(payload)).toBe(true);
    }
  });

  it('round-trips ASCII text', async () => {
    const text = JSON.stringify({ type: 'x', chunk: 'AbC-_09'.repeat(100) });
    const m = encodePdf417(text, { columns: 12, eclevel: 3 });
    const decoded = await decodePdf417(matrixToRgba(m, 3));
    expect(decoded?.toString('utf8')).toBe(text);
  });
});
