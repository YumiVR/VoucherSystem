const B64URL_RE = /^[A-Za-z0-9_-]*$/;
const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function bytesToBinary(bytes: Uint8Array): string {
  let out = '';
  const step = 0x2000;
  for (let i = 0; i < bytes.length; i += step) {
    out += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return out;
}

function binaryToBytes(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isBase64Url(value: string): boolean {
  // A single trailing character cannot encode a whole byte.
  return B64URL_RE.test(value) && value.length % 4 !== 1;
}

export function fromBase64Url(value: string): Uint8Array {
  if (!isBase64Url(value)) throw new Error('Invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return binaryToBytes(atob(padded));
}

export function toBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinary(bytes));
}

export function fromBase64(value: string): Uint8Array {
  if (!B64_RE.test(value) || value.length % 4 !== 0) throw new Error('Invalid base64');
  return binaryToBytes(atob(value));
}
