import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voucherPayloadSchema } from '../../src/shared/schemas/protocol';
import { localTimestampNow, rollingKeyFromIsoDate } from '../../src/shared/utilities/dates';
import { sealVoucher } from '../../src/main/vouchers/voucherCrypto';
import { MemorySecretProtector } from '../../src/main/crypto/protector';
import { runMigrations } from '../../src/main/database/db';
import { Installation } from '../../src/main/services/installation';
import { IssuerService } from '../../src/main/services/issuerService';
import { RedeemerService } from '../../src/main/services/redeemerService';

const here = fileURLToPath(new URL('.', import.meta.url));
export const MIGRATIONS_DIR = resolve(here, '../../migrations');
export const FONTS_DIR = resolve(here, '../../assets/fonts');

export interface Clock {
  now: Date;
}

export function makeInstallation(clock: Clock): Installation {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  runMigrations(db, MIGRATIONS_DIR);
  return new Installation({ db, protector: new MemorySecretProtector(), now: () => clock.now });
}

export const ADMIN_PASSWORD = 'correct horse battery';

export interface PairedWorld {
  clock: Clock;
  issuer: Installation;
  redeemer: Installation;
  issuerSvc: IssuerService;
  redeemerSvc: RedeemerService;
  setupParts: string[];
}

/** Two installations paired through the real barcode payload formats (without a camera). */
export async function makePairedWorld(start = new Date('2026-03-10T10:30:45.000Z')): Promise<PairedWorld> {
  const clock: Clock = { now: start };
  const issuer = makeInstallation(clock);
  const redeemer = makeInstallation(clock);
  await issuer.setup('issuer', ADMIN_PASSWORD);
  await redeemer.setup('redeemer', ADMIN_PASSWORD);
  const issuerSvc = new IssuerService(issuer);
  const redeemerSvc = new RedeemerService(redeemer);

  const request = issuerSvc.pairingRequestText();
  const { parts } = await redeemerSvc.acceptPairingRequest(Buffer.from(request, 'utf8'));
  for (const p of parts) issuerSvc.submitSetupPart(Buffer.from(p, 'utf8'));
  redeemerSvc.setExpiry('2026-12-31T23:59:59.000Z', 'Europe/London');
  return { clock, issuer, redeemer, issuerSvc, redeemerSvc, setupParts: parts };
}

/** Builds a sealed voucher with arbitrary field overrides, optionally signed by a different Issuer key. */
export function craftVoucher(
  w: PairedWorld,
  patch: Record<string, unknown> = {},
  keys?: { issuerPrivateKeyDer?: Buffer; redeemerPublicKeyDer?: Buffer },
): Buffer {
  const ts = localTimestampNow(w.clock.now);
  const codes = w.issuer.rollingCodes()!;
  const payload = voucherPayloadSchema.parse({
    type: 'voucher',
    version: 1,
    voucherId: randomUUID(),
    fullName: 'Crafted Person',
    amountPence: 400,
    currency: 'GBP',
    rollingDateCode: codes[rollingKeyFromIsoDate(ts.date)],
    dateCreated: ts.date,
    timeCreated: ts.time,
    createdAt: ts.iso,
    installationIdentifier: w.issuer.identifier(),
    ...patch,
  });
  return sealVoucher({
    payload,
    issuerPrivateKeyDer: keys?.issuerPrivateKeyDer ?? w.issuer.privateKeyDer(),
    redeemerPublicKeyDer: keys?.redeemerPublicKeyDer ?? w.redeemer.publicKeyDer(),
  });
}
