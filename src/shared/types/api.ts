import type { Role, VoucherLayoutId } from '../constants/index';
import type { RedeemFailureCode } from '../constants/messages';

export type Result<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface BarcodeImage {
  /** data: URL (SVG) of a PDF417 symbol including its quiet zone. */
  dataUrl: string;
  widthModules: number;
  heightModules: number;
}

export type PairingState = 'not-started' | 'awaiting-peer' | 'paired';

export interface ScannerConfig {
  prefix: string;
  suffix: string;
  terminator: 'enter' | 'tab' | 'none';
}

export interface AppState {
  appVersion: string;
  role: Role | null;
  /** Role requested with --role=..., used to skip the role choice on first run. */
  launchRole: Role | null;
  pairingState: PairingState;
  adminUnlocked: boolean;
  clockBlocked: boolean;
  secureStorageAvailable: boolean;
}

export interface PairingStatus {
  role: Role;
  state: PairingState;
  sessionReference: string | null;
  ownKeyFingerprint: string | null;
  peerKeyFingerprint: string | null;
  /** Visible to administrators only. */
  installationIdentifier: string | null;
}

export interface SetupProgress {
  captured: number[];
  total: number | null;
  complete: boolean;
  paired: boolean;
  message: string;
}

export interface CreatedVoucher {
  voucherId: string;
  reference: string;
  fullName: string;
  amountPence: number;
  amountDisplay: string;
  dateCreatedUk: string;
  barcode: BarcodeImage;
}

export interface VoucherSummary {
  fullName: string;
  amountPence: number;
  amountDisplay: string;
  dateCreatedUk: string;
  reference: string;
}

export type ValidateOutcome =
  | { ok: true; ticketId: string; voucher: VoucherSummary }
  | { ok: false; code: RedeemFailureCode };

export type ConfirmOutcome =
  | { ok: true; voucher: VoucherSummary; redeemedDateUk: string; redeemedTime: string }
  | { ok: false; code: RedeemFailureCode };

export interface HistoryEntry {
  voucherId: string;
  reference: string;
  fullName: string;
  amountDisplay: string;
  dateCreatedUk: string;
  redeemedDateUk: string;
  redeemedTime: string;
  redeemedAt: string;
}

export interface AuditEntry {
  id: number;
  eventType: string;
  eventTimestamp: string;
  details: string;
}

export interface ExpiryInfo {
  expiryIso: string | null;
  timeZone: string | null;
  display: string | null;
}

export interface BrandingConfig {
  organisationName: string;
  primaryColour: string;
  secondaryColour: string;
  textColour: string;
  footerText: string;
  layout: VoucherLayoutId;
  logo: { mime: 'image/png' | 'image/jpeg'; base64: string } | null;
}

export interface ScannerPrefs {
  cameraDeviceId: string | null;
}

export interface IpcContract {
  'app:getState': { req: undefined; res: AppState };
  'setup:begin': { req: { role: Role; adminPassword: string }; res: AppState };
  'admin:unlock': { req: { password: string }; res: AppState };
  'admin:lock': { req: undefined; res: AppState };
  'pairing:getStatus': { req: undefined; res: PairingStatus };
  'issuer:getPairingRequest': { req: undefined; res: { barcode: BarcodeImage; reference: string } };
  'issuer:submitSetupPart': { req: { dataBase64: string }; res: SetupProgress };
  'redeemer:submitPairingRequest': { req: { dataBase64: string }; res: { reference: string; parts: BarcodeImage[] } };
  'redeemer:getSetupParts': { req: undefined; res: { parts: BarcodeImage[] } };
  'voucher:create': { req: { fullName: string; amount: string }; res: CreatedVoucher };
  'voucher:savePdf': { req: { voucherId: string }; res: { saved: boolean } };
  'voucher:printPdf': { req: { voucherId: string }; res: { opened: boolean } };
  'redeemer:validate': { req: { dataBase64: string }; res: ValidateOutcome };
  'redeemer:confirm': { req: { ticketId: string }; res: ConfirmOutcome };
  'redeemer:cancel': { req: { ticketId: string }; res: { cancelled: boolean } };
  'history:list': { req: { search: string; order: 'asc' | 'desc' }; res: { entries: HistoryEntry[] } };
  'audit:list': { req: { limit: number }; res: { entries: AuditEntry[] } };
  'expiry:get': { req: undefined; res: ExpiryInfo };
  'expiry:set': { req: { expiryIso: string; timeZone: string; confirmed: true }; res: ExpiryInfo };
  'clock:resolve': { req: { confirmed: true }; res: AppState };
  'branding:get': { req: undefined; res: BrandingConfig };
  'branding:set': { req: BrandingConfig; res: BrandingConfig };
  'scanner:getPrefs': { req: undefined; res: ScannerPrefs };
  'scanner:setCamera': { req: { deviceId: string | null }; res: ScannerPrefs };
  'scanner:getConfig': { req: undefined; res: ScannerConfig };
  'scanner:setConfig': { req: ScannerConfig; res: ScannerConfig };
  'scanner:getTestBarcode': { req: undefined; res: { barcode: BarcodeImage; expected: string } };
  'backup:create': { req: { adminPassword: string; backupPassword: string }; res: { saved: boolean } };
  'backup:restore': { req: { adminPassword: string; backupPassword: string }; res: { restored: boolean; state: AppState } };
  'installation:reset': { req: { adminPassword: string; confirmation: 'RESET' }; res: AppState };
  'admin:testPdf': { req: undefined; res: { opened: boolean } };
}

export type IpcChannel = keyof IpcContract;

export const IPC_CHANNELS: readonly IpcChannel[] = [
  'app:getState',
  'setup:begin',
  'admin:unlock',
  'admin:lock',
  'pairing:getStatus',
  'issuer:getPairingRequest',
  'issuer:submitSetupPart',
  'redeemer:submitPairingRequest',
  'redeemer:getSetupParts',
  'voucher:create',
  'voucher:savePdf',
  'voucher:printPdf',
  'redeemer:validate',
  'redeemer:confirm',
  'redeemer:cancel',
  'history:list',
  'audit:list',
  'expiry:get',
  'expiry:set',
  'clock:resolve',
  'branding:get',
  'branding:set',
  'scanner:getPrefs',
  'scanner:setCamera',
  'scanner:getConfig',
  'scanner:setConfig',
  'scanner:getTestBarcode',
  'backup:create',
  'backup:restore',
  'installation:reset',
  'admin:testPdf',
];

export interface VoucherApi {
  invoke<C extends IpcChannel>(channel: C, request: IpcContract[C]['req']): Promise<Result<IpcContract[C]['res']>>;
}
