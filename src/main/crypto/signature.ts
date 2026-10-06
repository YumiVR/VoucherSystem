import { constants, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

const PSS = { padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 } as const;

/** RSA-PSS with SHA-256 and a 32-byte salt. */
export function signData(privateKeyDer: Uint8Array, data: Uint8Array): Buffer {
  const key = createPrivateKey({ key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' });
  return sign('sha256', data, { key, ...PSS });
}

export function verifySignature(publicKeyDer: Uint8Array, data: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: 'der', type: 'spki' });
    return verify('sha256', data, { key, ...PSS }, signature);
  } catch {
    return false;
  }
}
