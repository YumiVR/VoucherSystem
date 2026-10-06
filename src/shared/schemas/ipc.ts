import { z } from 'zod';
import { LIMITS, VOUCHER_LAYOUTS } from '../constants/index';
import type { IpcChannel } from '../types/api';
import { safeText } from './common';

const password = z.string().min(1).max(LIMITS.passwordMax);
const barcodeBase64 = z.string().min(4).max(LIMITS.barcodeBase64).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const colour = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const none = z.undefined();

export const brandingSchema = z.strictObject({
  organisationName: safeText(1, LIMITS.organisationName),
  primaryColour: colour,
  secondaryColour: colour,
  textColour: colour,
  footerText: z.string().trim().max(LIMITS.footerText),
  layout: z.enum(Object.keys(VOUCHER_LAYOUTS) as [keyof typeof VOUCHER_LAYOUTS, ...(keyof typeof VOUCHER_LAYOUTS)[]]),
  logo: z
    .strictObject({
      mime: z.enum(['image/png', 'image/jpeg']),
      base64: z
        .string()
        .max(Math.ceil((LIMITS.logoBytes * 4) / 3) + 8)
        .regex(/^[A-Za-z0-9+/]+={0,2}$/),
    })
    .nullable(),
});

const affix = z.string().max(LIMITS.scannerAffix).regex(/^[\x20-\x7e]*$/);

export const scannerConfigSchema = z.strictObject({
  prefix: affix,
  suffix: affix,
  terminator: z.enum(['enter', 'tab', 'none']),
});

export const ipcRequestSchemas: Record<IpcChannel, z.ZodType> = {
  'app:getState': none,
  'setup:begin': z.strictObject({ role: z.enum(['issuer', 'redeemer']), adminPassword: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax) }),
  'admin:unlock': z.strictObject({ password }),
  'admin:lock': none,
  'pairing:getStatus': none,
  'issuer:getPairingRequest': none,
  'issuer:submitSetupPart': z.strictObject({ dataBase64: barcodeBase64 }),
  'redeemer:submitPairingRequest': z.strictObject({ dataBase64: barcodeBase64 }),
  'redeemer:getSetupParts': none,
  'voucher:create': z.strictObject({ fullName: z.string().max(200), amount: z.string().max(20) }),
  'voucher:savePdf': z.strictObject({ voucherId: z.string().max(36) }),
  'voucher:printPdf': z.strictObject({ voucherId: z.string().max(36) }),
  'redeemer:validate': z.strictObject({ dataBase64: barcodeBase64 }),
  'redeemer:confirm': z.strictObject({ ticketId: z.string().max(64) }),
  'redeemer:cancel': z.strictObject({ ticketId: z.string().max(64) }),
  'history:list': z.strictObject({ search: z.string().max(LIMITS.searchText), order: z.enum(['asc', 'desc']) }),
  'audit:list': z.strictObject({ limit: z.number().int().min(1).max(500) }),
  'expiry:get': none,
  'expiry:set': z.strictObject({ expiryIso: z.string().max(40), timeZone: z.string().max(64), confirmed: z.literal(true) }),
  'clock:resolve': z.strictObject({ confirmed: z.literal(true) }),
  'branding:get': none,
  'branding:set': brandingSchema,
  'scanner:getPrefs': none,
  'scanner:setCamera': z.strictObject({ deviceId: z.string().max(256).nullable() }),
  'scanner:getConfig': none,
  'scanner:setConfig': scannerConfigSchema,
  'scanner:getTestBarcode': none,
  'backup:create': z.strictObject({ adminPassword: password, backupPassword: z.string().min(LIMITS.backupPasswordMin).max(LIMITS.passwordMax) }),
  'backup:restore': z.strictObject({ adminPassword: z.string().max(LIMITS.passwordMax), backupPassword: password }),
  'installation:reset': z.strictObject({ adminPassword: password, confirmation: z.literal('RESET') }),
  'admin:testPdf': none,
};
