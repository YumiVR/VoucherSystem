import { CLOCK_ROLLBACK_TOLERANCE_MS, FUTURE_TOLERANCE_MS, SETTING_KEYS } from '../../shared/constants/index';
import type { RedeemFailureCode } from '../../shared/constants/messages';
import { voucherIdShort, type VoucherPayload } from '../../shared/schemas/protocol';
import { fromBase64Url, toBase64Url } from '../../shared/utilities/base64';
import { formatUkDate, localTimestampNow, rollingKeyFromIsoDate } from '../../shared/utilities/dates';
import { formatPence } from '../../shared/utilities/money';
import { digitsToBytes } from '../../shared/utilities/numeric';
import type { ConfirmOutcome, ExpiryInfo, HistoryEntry, ValidateOutcome, VoucherSummary } from '../../shared/types/api';
import { secureBytes, randomUpperLetters } from '../crypto/random';
import { AlreadyRedeemedError } from '../database/redemptions';
import { PairingError, buildSetupBlob, parsePairingRequest, splitSetupBlob } from '../pairing/protocol';
import { generateRollingDateCodes } from '../pairing/rollingCodes';
import { openVoucher, VoucherError } from '../vouchers/voucherCrypto';
import { Installation, InstallationError } from './installation';

const TICKET_TTL_MS = 5 * 60 * 1000;

interface Ticket {
  id: string;
  payload: VoucherPayload;
  expiresAt: number;
}

export class ExpiryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpiryError';
  }
}

export class RedeemerService {
  private ticket: Ticket | null = null;

  constructor(private readonly inst: Installation) {}

  // ----- Pairing -----

  /** Scans the Issuer request, then builds the encrypted, signed multi-part setup response. */
  async acceptPairingRequest(bytes: Uint8Array): Promise<{ reference: string; parts: string[] }> {
    this.inst.requireRole('redeemer');
    if (this.inst.pairingState() === 'paired') throw new InstallationError('ALREADY_CONFIGURED', 'Pairing is already complete');
    let parsed;
    try {
      parsed = parsePairingRequest(bytes);
    } catch (err) {
      if (err instanceof PairingError) throw err;
      throw new PairingError('format', 'Pairing request could not be read');
    }
    const identifier = randomUpperLetters(3);
    const codes = generateRollingDateCodes();
    const blob = buildSetupBlob({
      request: parsed.request,
      issuerPublicKeyDer: parsed.issuerPublicKeyDer,
      redeemerPublicKeyDer: this.inst.publicKeyDer(),
      redeemerPrivateKeyDer: this.inst.privateKeyDer(),
      identifier,
      rollingDateCodes: codes,
      now: this.inst.now(),
    });
    const s = this.inst.settings;
    s.set(SETTING_KEYS.peerPublicKey, parsed.request.issuerPublicKey);
    s.set(SETTING_KEYS.pairingSessionId, parsed.request.pairingSessionId);
    s.setSecret(SETTING_KEYS.identifier, Buffer.from(identifier, 'ascii'));
    s.setJsonSecret(SETTING_KEYS.rollingCodes, codes);
    s.set(SETTING_KEYS.setupBlob, toBase64Url(blob));
    s.set(SETTING_KEYS.pairingState, 'paired');
    this.inst.audit.record('PAIRING_COMPLETED', 'role=redeemer');
    return { reference: parsed.request.pairingSessionId.slice(0, 8).toUpperCase(), parts: this.setupPartTexts() };
  }

  /** The stored setup blob is already encrypted for the Issuer; it is kept so the parts can be shown again. */
  setupPartTexts(): string[] {
    this.inst.requireRole('redeemer');
    const blob = this.inst.settings.get(SETTING_KEYS.setupBlob);
    const session = this.inst.settings.get(SETTING_KEYS.pairingSessionId);
    if (!blob || !session) throw new InstallationError('NOT_CONFIGURED', 'No setup response is available');
    return splitSetupBlob(Buffer.from(fromBase64Url(blob)), session).parts.map((p) => JSON.stringify(p));
  }

  // ----- Expiry -----

  getExpiry(): ExpiryInfo {
    const raw = this.inst.settings.get(SETTING_KEYS.expiry);
    if (!raw) return { expiryIso: null, timeZone: null, display: null };
    const v = JSON.parse(raw) as { iso: string; timeZone: string };
    return { expiryIso: v.iso, timeZone: v.timeZone, display: formatInZone(v.iso, v.timeZone) };
  }

  setExpiry(iso: string, timeZone: string): ExpiryInfo {
    this.inst.requireRole('redeemer');
    const ms = Date.parse(iso);
    if (Number.isNaN(ms) || !/^\d{4}-\d{2}-\d{2}T/.test(iso)) throw new ExpiryError('Enter a valid expiry date and time.');
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone });
    } catch {
      throw new ExpiryError('The time zone is not valid.');
    }
    const normalised = new Date(ms).toISOString();
    const previous = this.getExpiry();
    this.inst.settings.set(SETTING_KEYS.expiry, JSON.stringify({ iso: normalised, timeZone }));
    this.inst.audit.record('EXPIRY_CHANGED', `from=${previous.expiryIso ?? 'unset'} to=${normalised} zone=${timeZone}`);
    return this.getExpiry();
  }

  // ----- Clock integrity -----

  /** Returns false (and latches a block) if the clock has moved backwards beyond tolerance. */
  checkClock(): boolean {
    if (this.inst.clockBlocked()) return false;
    const now = this.inst.now().getTime();
    const stored = this.inst.settings.get(SETTING_KEYS.latestTrustedTime);
    const latest = stored ? Date.parse(stored) : null;
    if (latest !== null && now < latest - CLOCK_ROLLBACK_TOLERANCE_MS) {
      this.inst.settings.set(SETTING_KEYS.clockBlocked, '1');
      this.inst.audit.record('CLOCK_ROLLBACK_DETECTED', `latestTrusted=${stored} observed=${new Date(now).toISOString()}`);
      return false;
    }
    if (latest === null || now > latest) this.inst.settings.set(SETTING_KEYS.latestTrustedTime, new Date(now).toISOString());
    return true;
  }

  /** Administrator accepts the current system time as the new trusted baseline. */
  resolveClockWarning(): void {
    this.inst.requireRole('redeemer');
    const now = this.inst.now().toISOString();
    this.inst.settings.set(SETTING_KEYS.latestTrustedTime, now);
    this.inst.settings.delete(SETTING_KEYS.clockBlocked);
    this.inst.audit.record('CLOCK_WARNING_RESOLVED', `newBaseline=${now}`);
  }

  // ----- Validation and redemption -----

  /** Entry point for scanner and camera input: the barcode text carries the envelope as decimal digits. */
  validateScan(scan: Uint8Array): ValidateOutcome {
    this.inst.requireRole('redeemer');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(scan).trim();
    if (!/^[0-9]+$/.test(text)) {
      this.inst.audit.record('VOUCHER_REJECTED', 'code=INVALID_STRUCTURE detail=not a voucher barcode');
      return { ok: false, code: 'INVALID_STRUCTURE' };
    }
    const envelope = digitsToBytes(text);
    if (!envelope) {
      this.inst.audit.record('VOUCHER_REJECTED', 'code=CORRUPTED_BARCODE detail=digits did not decode');
      return { ok: false, code: 'CORRUPTED_BARCODE' };
    }
    return this.validate(envelope);
  }

  validate(barcodeBytes: Uint8Array): ValidateOutcome {
    this.inst.requireRole('redeemer');
    const fail = (code: RedeemFailureCode, technical = ''): ValidateOutcome => {
      this.inst.audit.record('VOUCHER_REJECTED', `code=${code}${technical ? ` detail=${technical}` : ''}`);
      return { ok: false, code };
    };
    if (this.inst.pairingState() !== 'paired') return { ok: false, code: 'NOT_PAIRED' };
    if (!this.checkClock()) return { ok: false, code: 'CLOCK_INTEGRITY' };

    const issuerKey = this.inst.peerPublicKeyDer();
    const identifier = this.inst.identifier();
    const codes = this.inst.rollingCodes();
    if (!issuerKey || !identifier || !codes) return { ok: false, code: 'NOT_PAIRED' };

    let payload: VoucherPayload;
    try {
      payload = openVoucher({
        barcodeBytes,
        redeemerPrivateKeyDer: this.inst.privateKeyDer(),
        issuerPublicKeyDer: issuerKey,
      });
    } catch (err) {
      if (err instanceof VoucherError) return fail(err.code, err.technical);
      return fail('UNABLE_TO_DECRYPT', 'unexpected');
    }

    if (payload.installationIdentifier !== identifier) return fail('WRONG_INSTALLATION_ID');
    if (codes[rollingKeyFromIsoDate(payload.dateCreated)] !== payload.rollingDateCode) return fail('INVALID_ROLLING_CODE');

    const now = this.inst.now().getTime();
    if (Date.parse(payload.createdAt) > now + FUTURE_TOLERANCE_MS) return fail('FUTURE_DATE');

    const expiryCode = this.expiryProblem(now);
    if (expiryCode) return fail(expiryCode);

    try {
      if (this.inst.redemptions.exists(payload.voucherId)) return fail('ALREADY_REDEEMED');
    } catch {
      return fail('DATABASE_ERROR', 'lookup failed');
    }

    if (this.ticket && this.ticket.payload.voucherId === payload.voucherId && this.ticket.expiresAt > now) {
      return { ok: true, ticketId: this.ticket.id, voucher: summarise(payload) };
    }
    this.ticket = { id: secureBytes(24).toString('hex'), payload, expiresAt: now + TICKET_TTL_MS };
    return { ok: true, ticketId: this.ticket.id, voucher: summarise(payload) };
  }

  private expiryProblem(nowMs: number): RedeemFailureCode | null {
    const raw = this.inst.settings.get(SETTING_KEYS.expiry);
    if (!raw) return 'EXPIRY_NOT_CONFIGURED';
    const { iso } = JSON.parse(raw) as { iso: string };
    return nowMs > Date.parse(iso) ? 'EXPIRED' : null;
  }

  confirm(ticketId: string): ConfirmOutcome {
    this.inst.requireRole('redeemer');
    const t = this.ticket;
    if (!t || t.id !== ticketId || t.expiresAt < this.inst.now().getTime()) {
      this.ticket = null;
      return { ok: false, code: 'TICKET_INVALID' };
    }
    // The ticket is consumed first so a repeated confirm can never reach the database twice.
    this.ticket = null;
    if (!this.checkClock()) return { ok: false, code: 'CLOCK_INTEGRITY' };
    const nowDate = this.inst.now();
    const expiryCode = this.expiryProblem(nowDate.getTime());
    if (expiryCode) return { ok: false, code: expiryCode };

    const p = t.payload;
    const ts = localTimestampNow(nowDate);
    try {
      this.inst.redemptions.insert(
        {
          voucherId: p.voucherId,
          fullName: p.fullName,
          amountPence: p.amountPence,
          currency: p.currency,
          dateCreated: p.dateCreated,
          timeCreated: p.timeCreated,
          createdAt: p.createdAt,
          dateRedeemed: ts.date,
          timeRedeemed: ts.time,
          redeemedAt: ts.iso,
          installationIdentifier: p.installationIdentifier,
          payloadVersion: p.version,
          recordedAt: nowDate.toISOString(),
        },
        () => this.inst.audit.record('VOUCHER_REDEEMED', `ref=${voucherIdShort(p.voucherId)}`),
      );
    } catch (err) {
      if (err instanceof AlreadyRedeemedError) {
        this.inst.audit.record('VOUCHER_REJECTED', 'code=ALREADY_REDEEMED');
        return { ok: false, code: 'ALREADY_REDEEMED' };
      }
      this.inst.audit.record('DATABASE_ERROR', 'redemption insert failed');
      return { ok: false, code: 'DATABASE_ERROR' };
    }
    return { ok: true, voucher: summarise(p), redeemedDateUk: formatUkDate(ts.date), redeemedTime: ts.time };
  }

  cancel(ticketId: string): boolean {
    if (this.ticket?.id === ticketId) {
      this.ticket = null;
      return true;
    }
    return false;
  }

  history(search: string, order: 'asc' | 'desc'): HistoryEntry[] {
    this.inst.requireRole('redeemer');
    return this.inst.redemptions.list(search, order).map((r) => ({
      voucherId: r.voucherId,
      reference: voucherIdShort(r.voucherId),
      fullName: r.fullName,
      amountDisplay: formatPence(r.amountPence),
      dateCreatedUk: formatUkDate(r.dateCreated),
      redeemedDateUk: formatUkDate(r.dateRedeemed),
      redeemedTime: r.timeRedeemed,
      redeemedAt: r.redeemedAt,
    }));
  }
}

function summarise(p: VoucherPayload): VoucherSummary {
  return {
    fullName: p.fullName,
    amountPence: p.amountPence,
    amountDisplay: formatPence(p.amountPence),
    dateCreatedUk: formatUkDate(p.dateCreated),
    reference: voucherIdShort(p.voucherId),
  };
}

function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'full', timeStyle: 'long', timeZone }).format(new Date(iso));
}
