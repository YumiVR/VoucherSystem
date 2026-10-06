import { createHash, createPrivateKey, createPublicKey, generateKeyPair } from 'node:crypto';
import { promisify } from 'node:util';

const generateKeyPairAsync = promisify(generateKeyPair);

export const RSA_MODULUS_BITS = 3072;
export const RSA_BYTES = RSA_MODULUS_BITS / 8;

export interface RsaKeyPair {
  /** SPKI DER. */
  publicKeyDer: Buffer;
  /** PKCS#8 DER. Never leaves the main process. */
  privateKeyDer: Buffer;
}

export async function generateRsaKeyPair(): Promise<RsaKeyPair> {
  const { publicKey, privateKey } = await generateKeyPairAsync('rsa', {
    modulusLength: RSA_MODULUS_BITS,
    publicExponent: 0x10001,
  });
  return {
    publicKeyDer: publicKey.export({ type: 'spki', format: 'der' }),
    privateKeyDer: privateKey.export({ type: 'pkcs8', format: 'der' }),
  };
}

export function publicKeyFromPrivate(privateKeyDer: Uint8Array): Buffer {
  const priv = createPrivateKey({ key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' });
  return createPublicKey(priv).export({ type: 'spki', format: 'der' });
}

/** Throws unless the bytes are an RSA-3072 public key with exponent 65537. */
export function assertAcceptablePublicKey(spkiDer: Uint8Array): void {
  const key = createPublicKey({ key: Buffer.from(spkiDer), format: 'der', type: 'spki' });
  const d = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType !== 'rsa' || d?.modulusLength !== RSA_MODULUS_BITS || d.publicExponent !== 65537n) {
    throw new Error('Unsupported public key');
  }
}

/** Short identifier carried in the binary envelope header to select the recipient key. */
export function keyIdOf(publicKeyDer: Uint8Array): string {
  return createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 16);
}

/** Non-sensitive, human-comparable fingerprint (SHA-256 of the SPKI, grouped). */
export function fingerprintOf(publicKeyDer: Uint8Array): string {
  const hex = createHash('sha256').update(publicKeyDer).digest('hex').toUpperCase();
  return (hex.slice(0, 32).match(/.{4}/g) ?? []).join(' ');
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}
