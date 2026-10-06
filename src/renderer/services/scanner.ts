import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { toBase64 } from '@shared/utilities/base64';

const wasmUrl = new URL('../../../node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', import.meta.url).href;

// The decoder runs fully offline from the bundled WebAssembly file.
prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
  },
});

/** Decodes the first PDF417 symbol in an image, returning its raw bytes. */
export async function decodeImageData(image: ImageData): Promise<Uint8Array | null> {
  const results = await readBarcodes(image, { formats: ['PDF417'], tryHarder: true, tryRotate: true, maxNumberOfSymbols: 1 });
  const hit = results.find((r) => r.isValid && r.bytes.length > 0);
  return hit ? new Uint8Array(hit.bytes) : null;
}

export async function decodeImageFile(file: File): Promise<Uint8Array | null> {
  if (!file.type.startsWith('image/') || file.size > 25 * 1024 * 1024) return null;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await decodeImageData(ctx.getImageData(0, 0, canvas.width, canvas.height));
  } finally {
    bitmap.close();
  }
}

export const bytesToBase64 = toBase64;

/** Hardware scanners in keyboard mode send characters; accept them only if every code is a single byte. */
export function keyboardTextToBytes(text: string): Uint8Array | null {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) return null;
    out[i] = c;
  }
  return out.length > 0 ? out : null;
}
