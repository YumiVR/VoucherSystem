import { PDFDocument } from 'pdf-lib';
import { DEFAULT_AMOUNT_PENCE, LIMITS, SCANNER_TEST_TEXT, SETTING_KEYS, type Role } from '../../shared/constants/index';
import { voucherIdShort } from '../../shared/schemas/protocol';
import { brandingSchema, scannerConfigSchema } from '../../shared/schemas/ipc';
import { fromBase64 } from '../../shared/utilities/base64';
import { bytesToDigits } from '../../shared/utilities/numeric';
import { DEFAULT_WEDGE_CONFIG } from '../../shared/utilities/wedgeParser';
import { formatUkDate } from '../../shared/utilities/dates';
import { formatPence } from '../../shared/utilities/money';
import type {
  BarcodeImage,
  BrandingConfig,
  CreatedVoucher,
  IpcChannel,
  IpcContract,
  ScannerConfig,
  ValidateOutcome,
} from '../../shared/types/api';
import { BackupError, createBackup, restoreBackup } from '../backup/backup';
import { encodePdf417, matrixToSvgDataUrl, totalModules } from '../pdf/barcode';
import { DEFAULT_BRANDING, LayoutError, renderVoucherPdf } from '../pdf/voucherPdf';
import { PairingError } from '../pairing/protocol';
import { AdminError, AdminSession } from '../services/adminSession';
import { Installation, InstallationError } from '../services/installation';
import { IssuerService, VoucherInputError } from '../services/issuerService';
import { ExpiryError, RedeemerService } from '../services/redeemerService';

export interface UiHooks {
  savePdf(defaultName: string, bytes: Uint8Array): Promise<boolean>;
  openForPrint(defaultName: string, bytes: Uint8Array): Promise<boolean>;
  saveBackup(defaultName: string, bytes: Uint8Array): Promise<boolean>;
  openBackup(): Promise<Buffer | null>;
}

export interface AppContext {
  inst: Installation;
  issuer: IssuerService;
  redeemer: RedeemerService;
  admin: AdminSession;
  ui: UiHooks;
  fontsDir: string;
  launchRole: Role | null;
}

/** An error whose message is safe to show to an operator. */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

type Handlers = { [K in IpcChannel]: (req: IpcContract[K]['req']) => Promise<IpcContract[K]['res']> };

const SAFE_MESSAGE = 'Something went wrong. The action was not completed.';

/** Converts any thrown value to a code and operator-safe message; internals are never exposed. */
export function toSafeError(err: unknown): { code: string; message: string } {
  if (err instanceof AppError) return { code: err.code, message: err.message };
  if (err instanceof AdminError) return { code: err.code, message: err.message };
  if (err instanceof VoucherInputError) return { code: 'INVALID_INPUT', message: err.message };
  if (err instanceof ExpiryError) return { code: 'INVALID_INPUT', message: err.message };
  if (err instanceof LayoutError) return { code: 'LAYOUT', message: err.message };
  if (err instanceof PairingError) return { code: 'PAIRING', message: 'The barcode could not be used for pairing.' };
  if (err instanceof BackupError) {
    const messages: Record<BackupError['code'], string> = {
      BAD_FILE: 'That file is not a valid backup.',
      BAD_PASSWORD_OR_CORRUPT: 'The backup password is wrong or the file is damaged.',
      ROLE_MISMATCH: 'That backup belongs to a different role and cannot be restored here.',
      UNSUPPORTED_VERSION: 'That backup was made by an incompatible version.',
      TOO_LARGE: 'That backup file is too large.',
    };
    return { code: err.code, message: messages[err.code] };
  }
  if (err instanceof InstallationError) {
    if (err.code === 'ALREADY_CONFIGURED') return { code: err.code, message: 'This action is not available once configured.' };
    if (err.code === 'NO_SECURE_STORAGE') {
      return { code: err.code, message: 'Operating-system secure storage is unavailable, so keys cannot be protected.' };
    }
    return { code: err.code, message: 'This action is not available for this installation.' };
  }
  return { code: 'INTERNAL', message: SAFE_MESSAGE };
}

function barcodeImage(input: Uint8Array | string, columns: number): BarcodeImage {
  const m = encodePdf417(input, { columns, eclevel: 4 });
  const t = totalModules(m);
  return { dataUrl: matrixToSvgDataUrl(m), widthModules: t.w, heightModules: t.h };
}

function decodeScan(base64: string): Buffer {
  const bytes = Buffer.from(fromBase64(base64));
  if (bytes.length === 0 || bytes.length > LIMITS.barcodeBytes) throw new AppError('BAD_BARCODE', 'The barcode is not valid.');
  return bytes;
}

function isPng(b: Buffer): boolean {
  return b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}
function isJpeg(b: Buffer): boolean {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

export function createHandlers(ctx: AppContext): Handlers {
  const { inst, issuer, redeemer, admin, ui } = ctx;
  const recentPdfs = new Map<string, Buffer>();

  const getBranding = (): BrandingConfig => {
    const raw = inst.settings.get(SETTING_KEYS.branding);
    if (!raw) return DEFAULT_BRANDING;
    const parsed = brandingSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_BRANDING;
  };

  const getScannerConfig = (): ScannerConfig => {
    const raw = inst.settings.get(SETTING_KEYS.scannerConfig);
    const parsed = raw ? scannerConfigSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? parsed.data : { ...DEFAULT_WEDGE_CONFIG };
  };

  const state = () => inst.state(admin.isUnlocked(), ctx.launchRole);

  const requireAdminPassword = async (password: string): Promise<void> => {
    await admin.verify(password);
  };

  return {
    'app:getState': async () => state(),

    'setup:begin': async ({ role, adminPassword }) => {
      await inst.setup(role, adminPassword);
      await admin.unlock(adminPassword);
      return state();
    },

    'admin:unlock': async ({ password }) => {
      if (!inst.getRole()) throw new AppError('NOT_CONFIGURED', 'Choose a role first.');
      await admin.unlock(password);
      return state();
    },

    'admin:lock': async () => {
      admin.lock();
      return state();
    },

    'pairing:getStatus': async () => inst.pairingStatus(admin.isUnlocked()),

    'issuer:getPairingRequest': async () => {
      const text = issuer.pairingRequestText();
      const reference = (JSON.parse(text) as { pairingSessionId: string }).pairingSessionId.slice(0, 8).toUpperCase();
      return { barcode: barcodeImage(text, 14), reference };
    },

    'issuer:submitSetupPart': async ({ dataBase64 }) => issuer.submitSetupPart(decodeScan(dataBase64)),

    'redeemer:submitPairingRequest': async ({ dataBase64 }) => {
      const { reference, parts } = await redeemer.acceptPairingRequest(decodeScan(dataBase64));
      return { reference, parts: parts.map((p) => barcodeImage(p, 14)) };
    },

    'redeemer:getSetupParts': async () => {
      admin.require();
      return { parts: redeemer.setupPartTexts().map((p) => barcodeImage(p, 14)) };
    },

    'voucher:create': async ({ fullName, amount }) => {
      const issued = issuer.createVoucher({ fullName, amount }, { allowCustomAmount: admin.isUnlocked() });
      const p = issued.payload;
      const pdf = await renderVoucherPdf({
        branding: getBranding(),
        fullName: p.fullName,
        amountPence: p.amountPence,
        dateCreatedIso: p.dateCreated,
        barcodeInput: bytesToDigits(issued.barcodeBytes),
        fontsDir: ctx.fontsDir,
      });
      recentPdfs.set(p.voucherId, Buffer.from(pdf.pdf));
      while (recentPdfs.size > 5) recentPdfs.delete(recentPdfs.keys().next().value as string);
      const t = totalModules(pdf.matrix, { rowHeight: pdf.rowHeight, quiet: 4 });
      const created: CreatedVoucher = {
        voucherId: p.voucherId,
        reference: voucherIdShort(p.voucherId),
        fullName: p.fullName,
        amountPence: p.amountPence,
        amountDisplay: formatPence(p.amountPence),
        dateCreatedUk: formatUkDate(p.dateCreated),
        barcode: {
          dataUrl: matrixToSvgDataUrl(pdf.matrix, { rowHeight: pdf.rowHeight, quiet: 4 }),
          widthModules: t.w,
          heightModules: t.h,
        },
      };
      return created;
    },

    'voucher:savePdf': async ({ voucherId }) => {
      const bytes = recentPdfs.get(voucherId);
      if (!bytes) throw new AppError('NOT_AVAILABLE', 'That voucher PDF is no longer available. Create it again.');
      return { saved: await ui.savePdf(`voucher_${voucherId}.pdf`, bytes) };
    },

    'voucher:printPdf': async ({ voucherId }) => {
      const bytes = recentPdfs.get(voucherId);
      if (!bytes) throw new AppError('NOT_AVAILABLE', 'That voucher PDF is no longer available. Create it again.');
      return { opened: await ui.openForPrint(`voucher_${voucherId}.pdf`, bytes) };
    },

    'redeemer:validate': async ({ dataBase64 }): Promise<ValidateOutcome> => {
      let bytes: Buffer;
      try {
        bytes = decodeScan(dataBase64);
      } catch {
        return { ok: false, code: 'CORRUPTED_BARCODE' };
      }
      try {
        return redeemer.validateScan(bytes);
      } catch (err) {
        if (err instanceof InstallationError) throw err;
        inst.audit.record('DATABASE_ERROR', 'validation failed unexpectedly');
        return { ok: false, code: 'DATABASE_ERROR' };
      }
    },

    'redeemer:confirm': async ({ ticketId }) => redeemer.confirm(ticketId),
    'redeemer:cancel': async ({ ticketId }) => ({ cancelled: redeemer.cancel(ticketId) }),

    'history:list': async ({ search, order }) => ({ entries: redeemer.history(search, order) }),

    'audit:list': async ({ limit }) => {
      admin.require();
      return { entries: inst.audit.list(limit) };
    },

    'expiry:get': async () => redeemer.getExpiry(),

    'expiry:set': async ({ expiryIso, timeZone }) => {
      admin.require();
      return redeemer.setExpiry(expiryIso, timeZone);
    },

    'clock:resolve': async () => {
      admin.require();
      redeemer.resolveClockWarning();
      return state();
    },

    'branding:get': async () => getBranding(),

    'branding:set': async (config) => {
      admin.require();
      if (config.logo) {
        const bytes = Buffer.from(config.logo.base64, 'base64');
        const okType = config.logo.mime === 'image/png' ? isPng(bytes) : isJpeg(bytes);
        if (!okType || bytes.length > LIMITS.logoBytes) throw new AppError('INVALID_INPUT', 'The logo must be a PNG or JPEG under 512 KB.');
        const doc = await PDFDocument.create();
        try {
          if (config.logo.mime === 'image/png') await doc.embedPng(bytes);
          else await doc.embedJpg(bytes);
        } catch {
          throw new AppError('INVALID_INPUT', 'The logo image could not be read.');
        }
      }
      inst.settings.set(SETTING_KEYS.branding, JSON.stringify(config));
      inst.audit.record('BRANDING_CHANGED', `layout=${config.layout}`);
      return getBranding();
    },

    'scanner:getPrefs': async () => ({ cameraDeviceId: inst.settings.get(SETTING_KEYS.cameraDeviceId) }),

    'scanner:setCamera': async ({ deviceId }) => {
      admin.require();
      if (deviceId) inst.settings.set(SETTING_KEYS.cameraDeviceId, deviceId);
      else inst.settings.delete(SETTING_KEYS.cameraDeviceId);
      return { cameraDeviceId: deviceId };
    },

    'scanner:getConfig': async () => getScannerConfig(),

    'scanner:setConfig': async (config) => {
      admin.require();
      inst.settings.set(SETTING_KEYS.scannerConfig, JSON.stringify(config));
      inst.audit.record('SCANNER_CONFIG_CHANGED', `terminator=${config.terminator}`);
      return getScannerConfig();
    },

    'scanner:getTestBarcode': async () => {
      admin.require();
      return { barcode: barcodeImage(SCANNER_TEST_TEXT, 10), expected: SCANNER_TEST_TEXT };
    },

    'backup:create': async ({ adminPassword, backupPassword }) => {
      admin.require();
      await requireAdminPassword(adminPassword);
      if (backupPassword === adminPassword) {
        throw new AppError('INVALID_INPUT', 'The backup password must differ from the administrator password.');
      }
      const file = await createBackup(inst, backupPassword);
      const role = inst.getRole() ?? 'installation';
      const stamp = inst.now().toISOString().slice(0, 10);
      return { saved: await ui.saveBackup(`voucher-redeem-${role}-${stamp}.vrbackup`, file) };
    },

    'backup:restore': async ({ adminPassword, backupPassword }) => {
      if (inst.getRole() !== null) {
        admin.require();
        await requireAdminPassword(adminPassword);
      }
      const file = await ui.openBackup();
      if (!file) return { restored: false, state: state() };
      await restoreBackup(inst, file, backupPassword);
      admin.lock();
      return { restored: true, state: state() };
    },

    'installation:reset': async ({ adminPassword }) => {
      admin.require();
      await requireAdminPassword(adminPassword);
      inst.reset();
      admin.lock();
      return state();
    },

    'admin:testPdf': async () => {
      admin.require();
      const result = await renderVoucherPdf({
        branding: getBranding(),
        fullName: 'Printer Test',
        amountPence: DEFAULT_AMOUNT_PENCE,
        dateCreatedIso: inst.now().toISOString().slice(0, 10),
        barcodeInput: 'VOUCHER-REDEEM-PRINT-TEST',
        fontsDir: ctx.fontsDir,
      });
      return { opened: await ui.openForPrint('printer-test.pdf', result.pdf) };
    },
  };
}
