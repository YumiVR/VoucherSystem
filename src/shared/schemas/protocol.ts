import { z } from 'zod';
import { CURRENCY, ENVELOPE_FORMAT, LIMITS, MAX_AMOUNT_PENCE, PROTOCOL_VERSION } from '../constants/index';
import { base64Url, installationIdentifier, isoDate, isoTime, isoTimestamp, rollingWord, safeText, uuidV4 } from './common';
import { isRollingDateKey, localTimestampFrom, offsetFromIso } from '../utilities/dates';

export const envelopeTypeSchema = z.enum(['setup-response', 'voucher']);

/** Descriptive (human-readable) model of an encrypted envelope. */
export const envelopeSchema = z.strictObject({
  format: z.literal(ENVELOPE_FORMAT),
  version: z.literal(PROTOCOL_VERSION),
  type: envelopeTypeSchema,
  keyId: z.string().regex(/^[0-9a-f]{16}$/),
  wrappedKey: base64Url(600),
  iv: base64Url(32),
  ciphertext: base64Url(LIMITS.base64Url),
  authTag: base64Url(32),
  /** Present only on setup responses: RSA-PSS signature by the Redeemer over the envelope. */
  signature: base64Url(600).optional(),
});
export type Envelope = z.infer<typeof envelopeSchema>;

export const pairingRequestSchema = z.strictObject({
  type: z.literal('issuer-pairing-request'),
  version: z.literal(PROTOCOL_VERSION),
  pairingSessionId: uuidV4,
  issuerPublicKey: base64Url(LIMITS.publicKeyBase64Url),
  createdAt: isoTimestamp,
});
export type PairingRequest = z.infer<typeof pairingRequestSchema>;

export const setupPartSchema = z.strictObject({
  type: z.literal('setup-part'),
  version: z.literal(PROTOCOL_VERSION),
  pairingSessionId: uuidV4,
  partNumber: z.number().int().min(1).max(LIMITS.setupParts),
  totalParts: z.number().int().min(1).max(LIMITS.setupParts),
  payloadChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  chunkChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  // A slice of a base64url string, so only the alphabet is checked here; the whole payload is validated after reassembly.
  chunk: z.string().min(1).max(LIMITS.setupChunkChars + 8).regex(/^[A-Za-z0-9_-]+$/, 'Invalid base64url'),
});
export type SetupPart = z.infer<typeof setupPartSchema>;

export const rollingDateCodesSchema = z
  .record(z.string(), rollingWord)
  .superRefine((codes, ctx) => {
    const keys = Object.keys(codes);
    if (keys.length !== 366) ctx.addIssue({ code: 'custom', message: 'Rolling date codes must contain 366 entries' });
    for (const k of keys) {
      if (!isRollingDateKey(k)) ctx.addIssue({ code: 'custom', message: 'Invalid rolling date key' });
    }
  });

export const setupPayloadSchema = z.strictObject({
  type: z.literal('redeemer-setup'),
  version: z.literal(PROTOCOL_VERSION),
  pairingSessionId: uuidV4,
  redeemerPublicKey: base64Url(LIMITS.publicKeyBase64Url),
  identifier: installationIdentifier,
  rollingDateCodes: rollingDateCodesSchema,
  createdAt: isoTimestamp,
});
export type SetupPayload = z.infer<typeof setupPayloadSchema>;

export const fullNameSchema = safeText(1, LIMITS.fullNameChars).refine(
  (v) => new TextEncoder().encode(v).length <= LIMITS.fullNameBytes,
  'Name is too long',
);

export const voucherPayloadSchema = z
  .strictObject({
    type: z.literal('voucher'),
    version: z.literal(PROTOCOL_VERSION),
    voucherId: uuidV4,
    fullName: fullNameSchema,
    amountPence: z.number().int().min(1).max(MAX_AMOUNT_PENCE),
    currency: z.literal(CURRENCY),
    rollingDateCode: rollingWord,
    dateCreated: isoDate,
    timeCreated: isoTime,
    createdAt: isoTimestamp,
    installationIdentifier,
  })
  .refine((v) => v.createdAt.slice(0, 19) === `${v.dateCreated}T${v.timeCreated}`, {
    message: 'createdAt does not match dateCreated and timeCreated',
  })
  .refine(
    (v) => {
      const offset = offsetFromIso(v.createdAt);
      if (offset === null) return false;
      return localTimestampFrom(Date.parse(v.createdAt), offset).iso === v.createdAt;
    },
    { message: 'createdAt is not canonical' },
  );
export type VoucherPayload = z.infer<typeof voucherPayloadSchema>;

export const voucherIdShort = (id: string): string => id.slice(0, 8).toUpperCase();
