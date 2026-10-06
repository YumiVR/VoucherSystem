import { LIMITS, PROTOCOL_VERSION } from '../../shared/constants/index';
import {
  pairingRequestSchema,
  setupPartSchema,
  setupPayloadSchema,
  type PairingRequest,
  type SetupPart,
  type SetupPayload,
} from '../../shared/schemas/protocol';
import { fromBase64Url, toBase64Url } from '../../shared/utilities/base64';
import { canonicalJson } from '../../shared/utilities/canonicalJson';
import {
  decodeEnvelope,
  decryptEnvelope,
  encodeEnvelope,
  encryptEnvelope,
  envelopeSignedBytes,
} from '../crypto/envelope';
import { assertAcceptablePublicKey, sha256Hex } from '../crypto/keys';
import { newUuidV4 } from '../crypto/random';
import { signData, verifySignature } from '../crypto/signature';
import type { RollingDateCodes } from './rollingCodes';

export type PairingErrorReason =
  | 'format'
  | 'schema'
  | 'wrong-session'
  | 'inconsistent'
  | 'duplicate'
  | 'altered'
  | 'incomplete'
  | 'checksum'
  | 'decrypt'
  | 'signature';

export class PairingError extends Error {
  constructor(
    public readonly reason: PairingErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'PairingError';
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  if (bytes.length === 0 || bytes.length > LIMITS.barcodeBytes) throw new PairingError('format', 'Barcode size out of range');
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new PairingError('format', 'Barcode is not valid JSON');
  }
}

// ---------- Issuer pairing request ----------

export function createPairingRequest(issuerPublicKeyDer: Uint8Array, now: Date): { request: PairingRequest; text: string } {
  const request = pairingRequestSchema.parse({
    type: 'issuer-pairing-request',
    version: PROTOCOL_VERSION,
    pairingSessionId: newUuidV4(),
    issuerPublicKey: toBase64Url(issuerPublicKeyDer),
    createdAt: now.toISOString(),
  });
  return { request, text: canonicalJson(request) };
}

export function parsePairingRequest(bytes: Uint8Array): { request: PairingRequest; issuerPublicKeyDer: Buffer } {
  const parsed = pairingRequestSchema.safeParse(parseJsonBytes(bytes));
  if (!parsed.success) throw new PairingError('schema', 'Not an issuer pairing request');
  const issuerPublicKeyDer = Buffer.from(fromBase64Url(parsed.data.issuerPublicKey));
  try {
    assertAcceptablePublicKey(issuerPublicKeyDer);
  } catch {
    throw new PairingError('schema', 'Unsupported issuer public key');
  }
  return { request: parsed.data, issuerPublicKeyDer };
}

// ---------- Redeemer setup response ----------

/** Encrypts the setup payload for the Issuer, signs the envelope with the Redeemer key and returns the wire blob. */
export function buildSetupBlob(args: {
  request: PairingRequest;
  issuerPublicKeyDer: Uint8Array;
  redeemerPublicKeyDer: Uint8Array;
  redeemerPrivateKeyDer: Uint8Array;
  identifier: string;
  rollingDateCodes: RollingDateCodes;
  now: Date;
}): Buffer {
  const payload: SetupPayload = setupPayloadSchema.parse({
    type: 'redeemer-setup',
    version: PROTOCOL_VERSION,
    pairingSessionId: args.request.pairingSessionId,
    redeemerPublicKey: toBase64Url(args.redeemerPublicKeyDer),
    identifier: args.identifier,
    rollingDateCodes: args.rollingDateCodes,
    createdAt: args.now.toISOString(),
  });
  const parts = encryptEnvelope({
    type: 'setup-response',
    recipientPublicKeyDer: args.issuerPublicKeyDer,
    plaintext: Buffer.from(canonicalJson(payload), 'utf8'),
    compress: true,
    signed: true,
  });
  parts.signature = signData(args.redeemerPrivateKeyDer, envelopeSignedBytes(parts));
  return encodeEnvelope(parts);
}

export interface SetupSplit {
  parts: SetupPart[];
  payloadChecksum: string;
}

/** Splits the blob into the fewest, evenly sized parts of at most `maxChunkChars` base64url characters. */
export function splitSetupBlob(blob: Uint8Array, pairingSessionId: string, maxChunkChars: number = LIMITS.setupChunkChars): SetupSplit {
  const encoded = toBase64Url(blob);
  const total = Math.ceil(encoded.length / maxChunkChars);
  if (total > LIMITS.setupParts) throw new Error('Setup payload is too large');
  const size = Math.ceil(encoded.length / total);
  const payloadChecksum = sha256Hex(blob);
  const parts: SetupPart[] = [];
  for (let i = 0; i < total; i++) {
    const chunk = encoded.slice(i * size, (i + 1) * size);
    parts.push(
      setupPartSchema.parse({
        type: 'setup-part',
        version: PROTOCOL_VERSION,
        pairingSessionId,
        partNumber: i + 1,
        totalParts: total,
        payloadChecksum,
        chunkChecksum: sha256Hex(chunk),
        chunk,
      }),
    );
  }
  return { parts, payloadChecksum };
}

export const setupPartText = (part: SetupPart): string => canonicalJson(part);

// ---------- Issuer reassembly ----------

export class SetupAssembler {
  private readonly parts = new Map<number, SetupPart>();
  private total: number | null = null;
  private payloadChecksum: string | null = null;

  constructor(private readonly pairingSessionId: string) {}

  get capturedParts(): number[] {
    return [...this.parts.keys()].sort((a, b) => a - b);
  }

  get totalParts(): number | null {
    return this.total;
  }

  get isComplete(): boolean {
    return this.total !== null && this.parts.size === this.total;
  }

  addPart(bytes: Uint8Array): number {
    const parsed = setupPartSchema.safeParse(parseJsonBytes(bytes));
    if (!parsed.success) throw new PairingError('schema', 'Not a setup part');
    const part = parsed.data;
    if (part.pairingSessionId !== this.pairingSessionId) throw new PairingError('wrong-session', 'Part belongs to another pairing session');
    if (part.partNumber > part.totalParts) throw new PairingError('schema', 'Part number exceeds total');
    if (sha256Hex(part.chunk) !== part.chunkChecksum) throw new PairingError('altered', 'Chunk checksum mismatch');
    if (this.total !== null && (part.totalParts !== this.total || part.payloadChecksum !== this.payloadChecksum)) {
      throw new PairingError('inconsistent', 'Part does not match the parts already captured');
    }
    if (this.parts.has(part.partNumber)) {
      const existing = this.parts.get(part.partNumber)!;
      throw new PairingError(existing.chunk === part.chunk ? 'duplicate' : 'altered', 'Part already captured');
    }
    this.total = part.totalParts;
    this.payloadChecksum = part.payloadChecksum;
    this.parts.set(part.partNumber, part);
    return part.partNumber;
  }

  /** Concatenates all chunks in order and verifies the full-payload checksum. */
  assemble(): Buffer {
    if (!this.isComplete || this.total === null) throw new PairingError('incomplete', 'Not all parts have been captured');
    let encoded = '';
    for (let i = 1; i <= this.total; i++) encoded += this.parts.get(i)!.chunk;
    let blob: Buffer;
    try {
      blob = Buffer.from(fromBase64Url(encoded));
    } catch {
      throw new PairingError('checksum', 'Reassembled payload is invalid');
    }
    if (sha256Hex(blob) !== this.payloadChecksum) throw new PairingError('checksum', 'Payload checksum mismatch');
    return blob;
  }
}

/** Decrypts and validates the reassembled setup blob. The Redeemer signature is verified with the key it contains. */
export function openSetupBlob(blob: Uint8Array, issuerPrivateKeyDer: Uint8Array, expectedSessionId: string): SetupPayload {
  let plaintext: Buffer;
  let parts;
  try {
    parts = decodeEnvelope(blob);
    if (parts.type !== 'setup-response' || !parts.signature) throw new Error('Not a signed setup response');
    plaintext = decryptEnvelope(parts, issuerPrivateKeyDer);
  } catch {
    throw new PairingError('decrypt', 'Setup payload could not be decrypted');
  }
  let json: unknown;
  try {
    json = JSON.parse(plaintext.toString('utf8'));
  } catch {
    throw new PairingError('schema', 'Setup payload is not valid JSON');
  }
  const parsed = setupPayloadSchema.safeParse(json);
  if (!parsed.success) throw new PairingError('schema', 'Setup payload failed validation');
  const payload = parsed.data;
  if (payload.pairingSessionId !== expectedSessionId) throw new PairingError('wrong-session', 'Setup belongs to another pairing session');
  const redeemerKey = Buffer.from(fromBase64Url(payload.redeemerPublicKey));
  try {
    assertAcceptablePublicKey(redeemerKey);
  } catch {
    throw new PairingError('schema', 'Unsupported Redeemer public key');
  }
  if (!verifySignature(redeemerKey, envelopeSignedBytes(parts), parts.signature)) {
    throw new PairingError('signature', 'Setup signature is invalid');
  }
  return payload;
}
