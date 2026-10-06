import { VOUCHER_PAYLOAD_VERSION } from '../../shared/constants/index';
import { voucherPayloadSchema, type VoucherPayload } from '../../shared/schemas/protocol';
import { localTimestampFrom } from '../../shared/utilities/dates';

export class PayloadCodecError extends Error {
  constructor(
    public readonly kind: 'structure' | 'version',
    message: string,
  ) {
    super(message);
    this.name = 'PayloadCodecError';
  }
}

const UUID_BYTES = 16;

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Compact binary form of a voucher payload (kept small so the whole voucher fits one PDF417).
 * Layout: version(1) uuid(16) amountPence(u32) epochMs(u48) offsetMinutes(i16) identifier(3)
 *         rollingWordLen(1) rollingWord name length(1) name(utf8)
 * Date, time and timestamp strings are derived from epochMs + offset, so they cannot disagree.
 */
export function encodeVoucherPayload(payload: VoucherPayload): Buffer {
  const p = voucherPayloadSchema.parse(payload);
  const epochMs = Date.parse(p.createdAt);
  const offsetMatch = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(p.createdAt)!;
  const offset = offsetMatch[1] === 'Z' ? 0 : (offsetMatch[2] === '-' ? -1 : 1) * (Number(offsetMatch[3]) * 60 + Number(offsetMatch[4]));
  const word = Buffer.from(p.rollingDateCode, 'ascii');
  const name = Buffer.from(p.fullName, 'utf8');
  const head = Buffer.alloc(1 + UUID_BYTES + 4 + 6 + 2);
  let o = 0;
  head[o++] = VOUCHER_PAYLOAD_VERSION;
  uuidToBytes(p.voucherId).copy(head, o);
  o += UUID_BYTES;
  head.writeUInt32BE(p.amountPence, o);
  o += 4;
  head.writeUIntBE(epochMs, o, 6);
  o += 6;
  head.writeInt16BE(offset, o);
  return Buffer.concat([
    head,
    Buffer.from(p.installationIdentifier, 'ascii'),
    Buffer.from([word.length]),
    word,
    Buffer.from([name.length]),
    name,
  ]);
}

export function decodeVoucherPayload(bytes: Uint8Array): VoucherPayload {
  const b = Buffer.from(bytes);
  const fixed = 1 + UUID_BYTES + 4 + 6 + 2 + 3 + 1;
  if (b.length < fixed + 1) throw new PayloadCodecError('structure', 'Payload too short');
  if (b[0] !== VOUCHER_PAYLOAD_VERSION) throw new PayloadCodecError('version', 'Unsupported payload version');
  let o = 1;
  const voucherId = bytesToUuid(b.subarray(o, o + UUID_BYTES));
  o += UUID_BYTES;
  const amountPence = b.readUInt32BE(o);
  o += 4;
  const epochMs = b.readUIntBE(o, 6);
  o += 6;
  const offset = b.readInt16BE(o);
  o += 2;
  const identifier = b.subarray(o, o + 3).toString('ascii');
  o += 3;
  const wordLen = b[o++]!;
  if (o + wordLen + 1 > b.length) throw new PayloadCodecError('structure', 'Truncated rolling word');
  const word = b.subarray(o, o + wordLen).toString('ascii');
  o += wordLen;
  const nameLen = b[o++]!;
  if (o + nameLen !== b.length) throw new PayloadCodecError('structure', 'Unexpected payload length');
  let name: string;
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(o, o + nameLen));
  } catch {
    throw new PayloadCodecError('structure', 'Name is not valid UTF-8');
  }
  if (Math.abs(offset) > 14 * 60 || !Number.isSafeInteger(epochMs) || Number.isNaN(new Date(epochMs).getTime())) {
    throw new PayloadCodecError('structure', 'Invalid timestamp');
  }
  const ts = localTimestampFrom(epochMs, offset);
  const parsed = voucherPayloadSchema.safeParse({
    type: 'voucher',
    version: 1,
    voucherId,
    fullName: name,
    amountPence,
    currency: 'GBP',
    rollingDateCode: word,
    dateCreated: ts.date,
    timeCreated: ts.time,
    createdAt: ts.iso,
    installationIdentifier: identifier,
  });
  if (!parsed.success) throw new PayloadCodecError('structure', 'Payload failed validation');
  return parsed.data;
}
