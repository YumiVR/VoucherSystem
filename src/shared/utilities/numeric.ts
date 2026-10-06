const MAX_DIGITS = 3000;

/**
 * Voucher barcodes carry decimal digits, not raw bytes: a keyboard-wedge scanner can type digits
 * reliably (no control characters, so no accidental Enter), and PDF417 numeric compaction is dense.
 * A leading 0x01 byte preserves leading zero bytes.
 */
export function bytesToDigits(bytes: Uint8Array): string {
  let hex = '01';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return BigInt(`0x${hex}`).toString(10);
}

export function digitsToBytes(digits: string): Uint8Array | null {
  if (digits.length === 0 || digits.length > MAX_DIGITS || !/^[0-9]+$/.test(digits)) return null;
  let hex = BigInt(digits).toString(16);
  if (hex.length % 2 === 1) hex = `0${hex}`;
  if (!hex.startsWith('01')) return null;
  const out = new Uint8Array((hex.length - 2) / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}
