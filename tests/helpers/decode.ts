import { readBarcodes } from 'zxing-wasm/reader';

export interface RasterImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  colorSpace?: 'srgb';
}

/** Decodes the first PDF417 in an RGBA raster using the same library as the renderer. */
export async function decodePdf417(image: RasterImage): Promise<Buffer | null> {
  const results = await readBarcodes(image as unknown as Parameters<typeof readBarcodes>[0], {
    formats: ['PDF417'],
    tryHarder: true,
    maxNumberOfSymbols: 1,
  });
  const hit = results.find((r) => r.isValid);
  return hit ? Buffer.from(hit.bytes) : null;
}
