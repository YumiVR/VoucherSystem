import type { RedeemFailureCode } from '../../shared/constants/messages';
import { LIMITS } from '../../shared/constants/index';
import { voucherPayloadSchema, type VoucherPayload } from '../../shared/schemas/protocol';
import { canonicalJson } from '../../shared/utilities/canonicalJson';
import {
  CryptoError,
  decodeEnvelope,
  decryptEnvelope,
  encodeEnvelope,
  encryptEnvelope,
} from '../crypto/envelope';
import { RSA_BYTES } from '../crypto/keys';
import { signData, verifySignature } from '../crypto/signature';
import { decodeVoucherPayload, encodeVoucherPayload, PayloadCodecError } from './payloadCodec';

export class VoucherError extends Error {
  constructor(
    public readonly code: RedeemFailureCode,
    /** Sanitised technical detail for protected diagnostics only. */
    public readonly technical: string,
  ) {
    super(code);
    this.name = 'VoucherError';
  }
}

export function signedBytesOf(payload: VoucherPayload): Buffer {
  return Buffer.from(canonicalJson(payload), 'utf8');
}

/** Sign the canonical payload, encrypt payload+signature for the Redeemer and return the single-symbol barcode bytes. */
export function sealVoucher(args: {
  payload: VoucherPayload;
  issuerPrivateKeyDer: Uint8Array;
  redeemerPublicKeyDer: Uint8Array;
}): Buffer {
  const payload = voucherPayloadSchema.parse(args.payload);
  const signature = signData(args.issuerPrivateKeyDer, signedBytesOf(payload));
  const plaintext = Buffer.concat([encodeVoucherPayload(payload), signature]);
  const parts = encryptEnvelope({
    type: 'voucher',
    recipientPublicKeyDer: args.redeemerPublicKeyDer,
    plaintext,
    compress: false,
  });
  const bytes = encodeEnvelope(parts);
  if (bytes.length > LIMITS.envelopeBytes) throw new Error('Voucher is too large for a single PDF417');
  return bytes;
}

/** Steps 2-7 of the redemption pipeline: envelope, decryption, structure and signature. */
export function openVoucher(args: {
  barcodeBytes: Uint8Array;
  redeemerPrivateKeyDer: Uint8Array;
  issuerPublicKeyDer: Uint8Array;
}): VoucherPayload {
  const bytes = Buffer.from(args.barcodeBytes);
  if (bytes.length === 0 || bytes.length > LIMITS.envelopeBytes) {
    throw new VoucherError('INVALID_STRUCTURE', 'Barcode length out of range');
  }
  if (bytes.length < 2 || bytes[0] !== 0x56 || bytes[1] !== 0x52) {
    throw new VoucherError('INVALID_STRUCTURE', 'Missing envelope magic');
  }
  let parts;
  try {
    parts = decodeEnvelope(bytes);
  } catch (err) {
    if (err instanceof CryptoError && err.code === 'VERSION') throw new VoucherError('UNSUPPORTED_VERSION', err.message);
    throw new VoucherError('CORRUPTED_BARCODE', 'Envelope could not be parsed');
  }
  if (parts.type !== 'voucher') throw new VoucherError('INVALID_STRUCTURE', 'Envelope is not a voucher');

  let plaintext: Buffer;
  try {
    plaintext = decryptEnvelope(parts, args.redeemerPrivateKeyDer);
  } catch (err) {
    if (err instanceof CryptoError) {
      if (err.code === 'WRONG_KEY') throw new VoucherError('WRONG_REDEEMER', err.message);
      if (err.code === 'AUTH_FAILED') throw new VoucherError('DATA_ALTERED', err.message);
      throw new VoucherError('UNABLE_TO_DECRYPT', err.message);
    }
    throw new VoucherError('UNABLE_TO_DECRYPT', 'Unexpected decryption failure');
  }
  if (plaintext.length <= RSA_BYTES) throw new VoucherError('INVALID_STRUCTURE', 'Package too short');
  const payloadBytes = plaintext.subarray(0, plaintext.length - RSA_BYTES);
  const signature = plaintext.subarray(plaintext.length - RSA_BYTES);

  let payload: VoucherPayload;
  try {
    payload = decodeVoucherPayload(payloadBytes);
  } catch (err) {
    if (err instanceof PayloadCodecError && err.kind === 'version') throw new VoucherError('UNSUPPORTED_VERSION', err.message);
    throw new VoucherError('INVALID_STRUCTURE', err instanceof Error ? err.message : 'Payload decode failed');
  }
  if (!verifySignature(args.issuerPublicKeyDer, signedBytesOf(payload), signature)) {
    throw new VoucherError('INVALID_SIGNATURE', 'RSA-PSS verification failed');
  }
  return payload;
}
