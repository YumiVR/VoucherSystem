import { SETTING_KEYS, type Role } from '../../shared/constants/index';
import type { AppState, PairingState, PairingStatus } from '../../shared/types/api';
import { toBase64Url, fromBase64Url } from '../../shared/utilities/base64';
import { hashPassword, verifyPassword } from '../crypto/password';
import { fingerprintOf, generateRsaKeyPair, publicKeyFromPrivate } from '../crypto/keys';
import type { SecretProtector } from '../crypto/protector';
import { AuditLog } from '../database/audit';
import type { Db } from '../database/db';
import { inTransaction } from '../database/db';
import { RedemptionStore } from '../database/redemptions';
import { SettingsStore } from '../database/settings';
import { createPairingRequest } from '../pairing/protocol';

export class InstallationError extends Error {
  constructor(
    public readonly code: 'ALREADY_CONFIGURED' | 'NOT_CONFIGURED' | 'WRONG_ROLE' | 'NO_SECURE_STORAGE' | 'BAD_PASSWORD',
    message: string,
  ) {
    super(message);
    this.name = 'InstallationError';
  }
}

export interface InstallationDeps {
  db: Db;
  protector: SecretProtector;
  now?: () => Date;
}

/** Owns the locked role, key material and pairing state of this computer. */
export class Installation {
  readonly db: Db;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly redemptions: RedemptionStore;
  readonly now: () => Date;
  private readonly protector: SecretProtector;

  constructor(deps: InstallationDeps) {
    this.db = deps.db;
    this.protector = deps.protector;
    this.now = deps.now ?? (() => new Date());
    this.settings = new SettingsStore(deps.db, deps.protector, this.now);
    this.audit = new AuditLog(deps.db, this.now);
    this.redemptions = new RedemptionStore(deps.db);
  }

  get secureStorageAvailable(): boolean {
    return this.protector.isAvailable();
  }

  getRole(): Role | null {
    const r = this.settings.get(SETTING_KEYS.role);
    return r === 'issuer' || r === 'redeemer' ? r : null;
  }

  requireRole(role: Role): void {
    if (this.getRole() !== role) throw new InstallationError('WRONG_ROLE', `This installation is not configured as ${role}`);
  }

  pairingState(): PairingState {
    const s = this.settings.get(SETTING_KEYS.pairingState);
    return s === 'awaiting-peer' || s === 'paired' ? s : 'not-started';
  }

  /** Generates this computer's RSA-3072 key pair, stores the admin password hash and locks the role. */
  async setup(role: Role, adminPassword: string): Promise<void> {
    if (this.getRole() !== null) throw new InstallationError('ALREADY_CONFIGURED', 'This installation is already configured');
    if (!this.protector.isAvailable()) throw new InstallationError('NO_SECURE_STORAGE', 'Secure storage is unavailable');
    const hash = await hashPassword(adminPassword);
    const keys = await generateRsaKeyPair();
    let requestText: string | null = null;
    if (role === 'issuer') requestText = createPairingRequest(keys.publicKeyDer, this.now()).text;
    inTransaction(this.db, () => {
      this.settings.set(SETTING_KEYS.role, role);
      this.settings.set(SETTING_KEYS.adminHash, hash);
      this.settings.setSecret(SETTING_KEYS.privateKey, keys.privateKeyDer);
      this.settings.set(SETTING_KEYS.publicKey, toBase64Url(keys.publicKeyDer));
      this.settings.set(SETTING_KEYS.pairingState, 'awaiting-peer');
      if (requestText) {
        this.settings.set(SETTING_KEYS.pairingRequest, requestText);
        this.settings.set(SETTING_KEYS.pairingSessionId, (JSON.parse(requestText) as { pairingSessionId: string }).pairingSessionId);
      }
      this.audit.record('INSTALLATION_CONFIGURED', `role=${role}`);
    });
    keys.privateKeyDer.fill(0);
  }

  async verifyAdminPassword(password: string): Promise<boolean> {
    const stored = this.settings.get(SETTING_KEYS.adminHash);
    if (!stored) return false;
    return verifyPassword(password, stored);
  }

  /** Private key bytes for in-process cryptographic operations only. Never expose over IPC. */
  privateKeyDer(): Buffer {
    const k = this.settings.getSecret(SETTING_KEYS.privateKey);
    if (!k) throw new InstallationError('NOT_CONFIGURED', 'No private key is stored');
    return k;
  }

  publicKeyDer(): Buffer {
    const v = this.settings.get(SETTING_KEYS.publicKey);
    if (!v) throw new InstallationError('NOT_CONFIGURED', 'No public key is stored');
    return Buffer.from(fromBase64Url(v));
  }

  peerPublicKeyDer(): Buffer | null {
    const v = this.settings.get(SETTING_KEYS.peerPublicKey);
    return v ? Buffer.from(fromBase64Url(v)) : null;
  }

  identifier(): string | null {
    return this.settings.getSecret(SETTING_KEYS.identifier)?.toString('utf8') ?? null;
  }

  rollingCodes(): Record<string, string> | null {
    return this.settings.getJsonSecret<Record<string, string>>(SETTING_KEYS.rollingCodes);
  }

  clockBlocked(): boolean {
    return this.settings.get(SETTING_KEYS.clockBlocked) === '1';
  }

  state(adminUnlocked: boolean, launchRole: Role | null = null): AppState {
    return {
      appVersion: '1.0.0',
      role: this.getRole(),
      launchRole,
      pairingState: this.pairingState(),
      adminUnlocked,
      clockBlocked: this.clockBlocked(),
      secureStorageAvailable: this.secureStorageAvailable,
    };
  }

  pairingStatus(includeIdentifier: boolean): PairingStatus {
    const role = this.getRole();
    if (!role) throw new InstallationError('NOT_CONFIGURED', 'Installation is not configured');
    const session = this.settings.get(SETTING_KEYS.pairingSessionId);
    const peer = this.peerPublicKeyDer();
    return {
      role,
      state: this.pairingState(),
      sessionReference: session ? session.slice(0, 8).toUpperCase() : null,
      ownKeyFingerprint: fingerprintOf(publicKeyFromPrivate(this.privateKeyDer())),
      peerKeyFingerprint: peer ? fingerprintOf(peer) : null,
      installationIdentifier: includeIdentifier ? this.identifier() : null,
    };
  }

  /** Deletes keys, configuration and redemptions. The audit log is retained and records the reset. */
  reset(): void {
    const role = this.getRole();
    inTransaction(this.db, () => {
      this.db.exec('DELETE FROM settings');
      this.db.exec('DELETE FROM redemptions');
      this.audit.record('INSTALLATION_RESET', `previousRole=${role ?? 'none'}`);
    });
  }
}
