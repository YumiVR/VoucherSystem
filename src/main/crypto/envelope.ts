import {
  constants,
  createCipheriv,
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  privateDecrypt,
  publicEncrypt,
} from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { ENVELOPE_FORMAT, PROTOCOL_VERSION } from '../../shared/constants/index';
import { envelopeSchema, type Envelope } from '../../shared/schemas/protocol';
import { fromBase64Url, toBase64Url } from '../../shared/utilities/base64';
import { keyIdOf, publicKeyFromPrivate, RSA_BYTES } from './keys';
import { secureBytes } from './random';

export type EnvelopeType = 'setup-response' | 'voucher';

export type CryptoErrorCode = 'STRUCTURE' | 'VERSION' | 'WRONG_KEY' | 'UNWRAP_FAILED' | 'AUTH_FAILED' | 'DECOMPRESS_FAILED';

export class CryptoError extends Error {
  constructor(
    public readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'CryptoError';
  }
}

export interface EnvelopeParts {
  type: EnvelopeType;
  /** 16 hex characters identifying the recipient public key. */
  keyId: string;
  compressed: boolean;
  wrappedKey: Buffer;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
  signature?: Buffer;
}

const MAGIC = Buffer.from('VR', 'ascii');
const TYPE_CODE: Record<EnvelopeType, number> = { 'setup-response': 1, voucher: 2 };
const FLAG_COMPRESSED = 0x01;
const FLAG_SIGNED = 0x02;
const HEADER_LEN = 13;
const IV_LEN = 12;
const TAG_LEN = 16;
const MAX_INFLATED = 256 * 1024;

function headerBytes(parts: Pick<EnvelopeParts, 'type' | 'keyId' | 'compressed'> & { signed: boolean }): Buffer {
  const h = Buffer.alloc(HEADER_LEN);
  MAGIC.copy(h, 0);
  h[2] = PROTOCOL_VERSION;
  h[3] = TYPE_CODE[parts.type];
  h[4] = (parts.compressed ? FLAG_COMPRESSED : 0) | (parts.signed ? FLAG_SIGNED : 0);
  Buffer.from(parts.keyId, 'hex').copy(h, 5);
  return h;
}

/** Bytes covered by the Redeemer's setup-response signature: everything except the signature itself. */
export function envelopeSignedBytes(parts: EnvelopeParts): Buffer {
  return Buffer.concat([
    headerBytes({ ...parts, signed: true }),
    parts.wrappedKey,
    parts.iv,
    parts.authTag,
    parts.ciphertext,
  ]);
}

/** Hybrid encryption: random AES-256 key, AES-256-GCM payload, RSA-OAEP(SHA-256) wrapped key. */
export function encryptEnvelope(args: {
  type: EnvelopeType;
  recipientPublicKeyDer: Uint8Array;
  plaintext: Uint8Array;
  compress: boolean;
  signed?: boolean;
}): EnvelopeParts {
  const keyId = keyIdOf(args.recipientPublicKeyDer);
  const aesKey = secureBytes(32);
  const iv = secureBytes(IV_LEN);
  const data = args.compress ? deflateRawSync(args.plaintext, { level: 9 }) : Buffer.from(args.plaintext);
  const aad = headerBytes({ type: args.type, keyId, compressed: args.compress, signed: args.signed ?? false });
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const publicKey = createPublicKey({ key: Buffer.from(args.recipientPublicKeyDer), format: 'der', type: 'spki' });
  const wrappedKey = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  );
  aesKey.fill(0);
  return { type: args.type, keyId, compressed: args.compress, wrappedKey, iv, authTag: cipher.getAuthTag(), ciphertext };
}

export function decryptEnvelope(parts: EnvelopeParts, privateKeyDer: Uint8Array): Buffer {
  const publicDer = publicKeyFromPrivate(privateKeyDer);
  if (parts.keyId !== keyIdOf(publicDer)) throw new CryptoError('WRONG_KEY', 'Envelope is addressed to a different key');
  const privateKey = createPrivateKey({ key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' });
  let aesKey: Buffer;
  try {
    aesKey = privateDecrypt(
      { key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      parts.wrappedKey,
    );
  } catch {
    throw new CryptoError('UNWRAP_FAILED', 'RSA-OAEP key unwrap failed');
  }
  if (aesKey.length !== 32) throw new CryptoError('UNWRAP_FAILED', 'Unexpected session key length');
  let plain: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-gcm', aesKey, parts.iv);
    decipher.setAAD(headerBytes({ ...parts, signed: parts.signature !== undefined }));
    decipher.setAuthTag(parts.authTag);
    plain = Buffer.concat([decipher.update(parts.ciphertext), decipher.final()]);
  } catch {
    throw new CryptoError('AUTH_FAILED', 'AES-GCM authentication failed');
  } finally {
    aesKey.fill(0);
  }
  if (!parts.compressed) return plain;
  try {
    return inflateRawSync(plain, { maxOutputLength: MAX_INFLATED });
  } catch {
    throw new CryptoError('DECOMPRESS_FAILED', 'Decompression failed');
  }
}

export function encodeEnvelope(parts: EnvelopeParts): Buffer {
  if (parts.wrappedKey.length !== RSA_BYTES || parts.iv.length !== IV_LEN || parts.authTag.length !== TAG_LEN) {
    throw new CryptoError('STRUCTURE', 'Envelope fields have unexpected sizes');
  }
  if (parts.signature && parts.signature.length !== RSA_BYTES) throw new CryptoError('STRUCTURE', 'Bad signature size');
  return Buffer.concat([
    headerBytes({ ...parts, signed: parts.signature !== undefined }),
    parts.wrappedKey,
    parts.iv,
    parts.authTag,
    parts.signature ?? Buffer.alloc(0),
    parts.ciphertext,
  ]);
}

export function decodeEnvelope(bytes: Uint8Array): EnvelopeParts {
  const b = Buffer.from(bytes);
  if (b.length < HEADER_LEN + RSA_BYTES + IV_LEN + TAG_LEN + 1 || !b.subarray(0, 2).equals(MAGIC)) {
    throw new CryptoError('STRUCTURE', 'Not a Voucher Redeem envelope');
  }
  if (b[2] !== PROTOCOL_VERSION) throw new CryptoError('VERSION', 'Unsupported envelope version');
  const type = (Object.keys(TYPE_CODE) as EnvelopeType[]).find((t) => TYPE_CODE[t] === b[3]);
  if (!type) throw new CryptoError('STRUCTURE', 'Unknown envelope type');
  const flags = b[4]!;
  if ((flags & ~(FLAG_COMPRESSED | FLAG_SIGNED)) !== 0) throw new CryptoError('STRUCTURE', 'Unknown envelope flags');
  const signed = (flags & FLAG_SIGNED) !== 0;
  let o = HEADER_LEN;
  const keyId = b.subarray(5, HEADER_LEN).toString('hex');
  const wrappedKey = b.subarray(o, (o += RSA_BYTES));
  const iv = b.subarray(o, (o += IV_LEN));
  const authTag = b.subarray(o, (o += TAG_LEN));
  let signature: Buffer | undefined;
  if (signed) signature = b.subarray(o, (o += RSA_BYTES));
  const ciphertext = b.subarray(o);
  if (ciphertext.length === 0) throw new CryptoError('STRUCTURE', 'Empty ciphertext');
  return {
    type,
    keyId,
    compressed: (flags & FLAG_COMPRESSED) !== 0,
    wrappedKey: Buffer.from(wrappedKey),
    iv: Buffer.from(iv),
    authTag: Buffer.from(authTag),
    ciphertext: Buffer.from(ciphertext),
    ...(signature ? { signature: Buffer.from(signature) } : {}),
  };
}

/** Human-readable JSON model of an envelope, validated against the strict schema. */
export function toEnvelopeModel(parts: EnvelopeParts): Envelope {
  return envelopeSchema.parse({
    format: ENVELOPE_FORMAT,
    version: PROTOCOL_VERSION,
    type: parts.type,
    keyId: parts.keyId,
    wrappedKey: toBase64Url(parts.wrappedKey),
    iv: toBase64Url(parts.iv),
    ciphertext: toBase64Url(parts.ciphertext),
    authTag: toBase64Url(parts.authTag),
    ...(parts.signature ? { signature: toBase64Url(parts.signature) } : {}),
  });
}

export function fromEnvelopeModel(model: unknown): EnvelopeParts {
  const m = envelopeSchema.parse(model);
  return {
    type: m.type,
    keyId: m.keyId,
    compressed: false,
    wrappedKey: Buffer.from(fromBase64Url(m.wrappedKey)),
    iv: Buffer.from(fromBase64Url(m.iv)),
    authTag: Buffer.from(fromBase64Url(m.authTag)),
    ciphertext: Buffer.from(fromBase64Url(m.ciphertext)),
    ...(m.signature ? { signature: Buffer.from(fromBase64Url(m.signature)) } : {}),
  };
}
