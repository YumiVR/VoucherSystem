import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import { ipcRequestSchemas } from '../../shared/schemas/ipc';
import { IPC_CHANNELS, type IpcChannel, type Result } from '../../shared/types/api';
import { createHandlers, toSafeError, type AppContext } from './handlers';

export interface RegisterOptions {
  /** Returns true when the frame that sent the request is one of our own pages. */
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

/** Registers one validated handler per channel. Unknown channels are never registered. */
export function registerIpc(ctx: AppContext, opts: RegisterOptions): void {
  const handlers = createHandlers(ctx) as unknown as Record<IpcChannel, (req: unknown) => Promise<unknown>>;
  for (const channel of IPC_CHANNELS) {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<Result<unknown>> => {
      if (!opts.isTrustedSender(event)) return { ok: false, code: 'FORBIDDEN', message: 'Request rejected.' };
      const parsed = ipcRequestSchemas[channel].safeParse(raw);
      if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST', message: 'The request was not valid.' };
      try {
        return { ok: true, data: await handlers[channel]!(parsed.data) };
      } catch (err) {
        const safe = toSafeError(err);
        // Only the error class and code are logged; messages can carry user data.
        if (safe.code === 'INTERNAL') console.error(`[ipc] ${channel} failed:`, err instanceof Error ? err.name : 'unknown');
        return { ok: false, code: safe.code, message: safe.message };
      }
    });
  }
}
