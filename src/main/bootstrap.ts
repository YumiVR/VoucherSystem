import type { Role } from '../shared/constants/index';
import type { SecretProtector } from './crypto/protector';
import type { Db } from './database/db';
import type { AppContext, UiHooks } from './ipc/handlers';
import { AdminSession } from './services/adminSession';
import { Installation } from './services/installation';
import { IssuerService } from './services/issuerService';
import { RedeemerService } from './services/redeemerService';

export interface BootstrapOptions {
  db: Db;
  protector: SecretProtector;
  fontsDir: string;
  ui: UiHooks;
  launchRole?: Role | null;
  now?: () => Date;
}

/** Wires the Electron-independent services together. */
export function createHandlersContext(opts: BootstrapOptions): AppContext {
  const inst = new Installation({ db: opts.db, protector: opts.protector, ...(opts.now ? { now: opts.now } : {}) });
  return {
    inst,
    issuer: new IssuerService(inst),
    redeemer: new RedeemerService(inst),
    admin: new AdminSession(inst),
    ui: opts.ui,
    launchRole: opts.launchRole ?? null,
    fontsDir: opts.fontsDir,
  };
}
