export const APP_NAME = 'Voucher Redeem';

export const ENVELOPE_FORMAT = 'voucher-redeem-envelope' as const;
export const PROTOCOL_VERSION = 1 as const;
export const VOUCHER_PAYLOAD_VERSION = 1 as const;

export const DEFAULT_AMOUNT_PENCE = 400;
export const MAX_AMOUNT_PENCE = 99_999_999;
export const CURRENCY = 'GBP' as const;

export const LIMITS = {
  fullNameChars: 60,
  fullNameBytes: 100,
  organisationName: 60,
  footerText: 120,
  rollingWord: 12,
  /** Largest binary voucher envelope that fits one PDF417. */
  envelopeBytes: 1_400,
  /** Largest barcode content accepted from any scan (voucher digits are about 2.4 per envelope byte). */
  barcodeBytes: 2_600,
  /** Largest base64 barcode string accepted over IPC. */
  barcodeBase64: 3_600,
  scannerAffix: 8,
  base64Url: 16_000,
  publicKeyBase64Url: 800,
  passwordMin: 10,
  passwordMax: 128,
  backupPasswordMin: 12,
  logoBytes: 512 * 1024,
  searchText: 80,
  setupParts: 40,
  setupChunkChars: 700,
} as const;

/** A voucher may be created slightly ahead of the Redeemer's clock; beyond this it is rejected. */
export const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** Permitted backwards movement of the system clock before redemption is blocked. */
export const CLOCK_ROLLBACK_TOLERANCE_MS = 2 * 60 * 1000;
export const ADMIN_SESSION_MS = 5 * 60 * 1000;

export const VOUCHER_LAYOUTS = {
  wallet: { label: 'Wallet card (85.6 x 54 mm)', widthMm: 85.6, heightMm: 54 },
  a6: { label: 'A6 landscape (148 x 105 mm)', widthMm: 148, heightMm: 105 },
  a5: { label: 'A5 landscape (210 x 148 mm)', widthMm: 210, heightMm: 148 },
} as const;
export type VoucherLayoutId = keyof typeof VOUCHER_LAYOUTS;

export const SETTING_KEYS = {
  role: 'installation.role',
  adminHash: 'admin.passwordHash',
  privateKey: 'keys.private',
  publicKey: 'keys.public',
  peerPublicKey: 'keys.peerPublic',
  pairingState: 'pairing.state',
  pairingSessionId: 'pairing.sessionId',
  pairingRequest: 'pairing.request',
  setupBlob: 'pairing.setupBlob',
  identifier: 'pairing.identifier',
  rollingCodes: 'pairing.rollingCodes',
  expiry: 'redeemer.expiry',
  latestTrustedTime: 'redeemer.latestTrustedTime',
  clockBlocked: 'redeemer.clockBlocked',
  branding: 'branding.config',
  cameraDeviceId: 'scanner.cameraDeviceId',
  scannerConfig: 'scanner.wedgeConfig',
} as const;

/** Known text shown by the Redeemer scanner test; deliberately mixes digits, letters and punctuation. */
export const SCANNER_TEST_TEXT = 'VOUCHER-REDEEM-SCANNER-TEST {"a":1} _-:+/=0123456789 abcXYZ';

export type Role = 'issuer' | 'redeemer';
