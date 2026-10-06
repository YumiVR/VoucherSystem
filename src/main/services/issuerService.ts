import { CURRENCY, DEFAULT_AMOUNT_PENCE, SETTING_KEYS, PROTOCOL_VERSION } from '../../shared/constants/index';
import { voucherPayloadSchema, fullNameSchema, voucherIdShort, type VoucherPayload } from '../../shared/schemas/protocol';
import { parseGbpToPence } from '../../shared/utilities/money';
import { localTimestampNow, rollingKeyFromIsoDate } from '../../shared/utilities/dates';
import type { SetupProgress } from '../../shared/types/api';
import { newUuidV4 } from '../crypto/random';
import { PairingError, openSetupBlob, SetupAssembler } from '../pairing/protocol';
import { sealVoucher } from '../vouchers/voucherCrypto';
import { Installation, InstallationError } from './installation';

export class VoucherInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoucherInputError';
  }
}

export interface IssuedVoucher {
  payload: VoucherPayload;
  barcodeBytes: Buffer;
  reference: string;
}

const PAIRING_MESSAGES: Record<string, string> = {
  format: 'That barcode could not be read as a setup part. Scan again.',
  schema: 'That is not a setup part for this application.',
  'wrong-session': 'That part belongs to a different pairing session and was ignored.',
  inconsistent: 'That part does not match the others captured so far and was ignored.',
  duplicate: 'That part has already been captured.',
  altered: 'That part failed its integrity check and was rejected.',
  incomplete: 'Not all parts have been captured yet.',
  checksum: 'The complete setup failed its checksum. All parts were discarded; scan them again.',
  decrypt: 'The setup could not be decrypted with this Issuer key. All parts were discarded.',
  signature: 'The setup signature is invalid. All parts were discarded.',
};

export class IssuerService {
  private assembler: SetupAssembler | null = null;

  constructor(private readonly inst: Installation) {}

  pairingRequestText(): string {
    this.inst.requireRole('issuer');
    const text = this.inst.settings.get(SETTING_KEYS.pairingRequest);
    if (!text) throw new InstallationError('NOT_CONFIGURED', 'No pairing request exists');
    return text;
  }

  /** Accepts one scanned setup part; completes pairing once all parts verify and decrypt. */
  submitSetupPart(bytes: Uint8Array): SetupProgress {
    this.inst.requireRole('issuer');
    if (this.inst.pairingState() === 'paired') {
      return { captured: [], total: null, complete: true, paired: true, message: 'Pairing is already complete.' };
    }
    const sessionId = this.inst.settings.get(SETTING_KEYS.pairingSessionId);
    if (!sessionId) throw new InstallationError('NOT_CONFIGURED', 'No pairing session exists');
    if (!this.assembler) this.assembler = new SetupAssembler(sessionId);
    const a = this.assembler;
    try {
      const n = a.addPart(bytes);
      if (!a.isComplete) {
        return { captured: a.capturedParts, total: a.totalParts, complete: false, paired: false, message: `Part ${n} captured.` };
      }
      const blob = a.assemble();
      const setup = openSetupBlob(blob, this.inst.privateKeyDer(), sessionId);
      this.inst.settings.set(SETTING_KEYS.peerPublicKey, setup.redeemerPublicKey);
      this.inst.settings.setSecret(SETTING_KEYS.identifier, Buffer.from(setup.identifier, 'ascii'));
      this.inst.settings.setJsonSecret(SETTING_KEYS.rollingCodes, setup.rollingDateCodes);
      this.inst.settings.set(SETTING_KEYS.pairingState, 'paired');
      this.inst.audit.record('PAIRING_COMPLETED', 'role=issuer');
      const total = a.totalParts;
      this.assembler = null;
      return { captured: Array.from({ length: total ?? 0 }, (_, i) => i + 1), total, complete: true, paired: true, message: 'Pairing complete.' };
    } catch (err) {
      if (!(err instanceof PairingError)) throw err;
      const fatal = ['checksum', 'decrypt', 'signature', 'schema'].includes(err.reason) && a.isComplete;
      if (fatal) this.assembler = null;
      this.inst.audit.record('PAIRING_PART_REJECTED', `reason=${err.reason}`);
      return {
        captured: this.assembler?.capturedParts ?? [],
        total: this.assembler?.totalParts ?? null,
        complete: false,
        paired: false,
        message: PAIRING_MESSAGES[err.reason] ?? 'The part was rejected.',
      };
    }
  }

  /** Validates input, signs and encrypts a voucher, and returns the single-symbol barcode bytes. */
  createVoucher(input: { fullName: string; amount: string }, opts: { allowCustomAmount: boolean }): IssuedVoucher {
    this.inst.requireRole('issuer');
    if (this.inst.pairingState() !== 'paired') throw new InstallationError('NOT_CONFIGURED', 'Pairing is not complete');
    const name = fullNameSchema.safeParse(input.fullName);
    if (!name.success) throw new VoucherInputError('Enter a full name of up to 60 characters without control characters.');
    const amount = parseGbpToPence(input.amount);
    if (!amount.ok) throw new VoucherInputError(amount.message);
    if (amount.pence !== DEFAULT_AMOUNT_PENCE && !opts.allowCustomAmount) {
      throw new VoucherInputError('An administrator must unlock custom amounts.');
    }
    const identifier = this.inst.identifier();
    const codes = this.inst.rollingCodes();
    const redeemerKey = this.inst.peerPublicKeyDer();
    if (!identifier || !codes || !redeemerKey) throw new InstallationError('NOT_CONFIGURED', 'Pairing data is missing');

    const ts = localTimestampNow(this.inst.now());
    const word = codes[rollingKeyFromIsoDate(ts.date)];
    if (!word) throw new InstallationError('NOT_CONFIGURED', 'No rolling code for this date');
    const payload = voucherPayloadSchema.parse({
      type: 'voucher',
      version: PROTOCOL_VERSION,
      voucherId: newUuidV4(),
      fullName: name.data,
      amountPence: amount.pence,
      currency: CURRENCY,
      rollingDateCode: word,
      dateCreated: ts.date,
      timeCreated: ts.time,
      createdAt: ts.iso,
      installationIdentifier: identifier,
    });
    const barcodeBytes = sealVoucher({
      payload,
      issuerPrivateKeyDer: this.inst.privateKeyDer(),
      redeemerPublicKeyDer: redeemerKey,
    });
    this.inst.audit.record('VOUCHER_CREATED', `ref=${voucherIdShort(payload.voucherId)}`);
    return { payload, barcodeBytes, reference: voucherIdShort(payload.voucherId) };
  }
}
