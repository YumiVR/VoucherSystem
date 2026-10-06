import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type IpcChannel, type Result, type VoucherApi } from '../shared/types/api';

const allowed: ReadonlySet<string> = new Set(IPC_CHANNELS);

const api: VoucherApi = {
  invoke(channel: IpcChannel, request: unknown) {
    if (!allowed.has(channel)) {
      return Promise.resolve({ ok: false, code: 'FORBIDDEN', message: 'Unknown request.' } as Result<never>);
    }
    return ipcRenderer.invoke(channel, request) as Promise<never>;
  },
};

contextBridge.exposeInMainWorld('voucherApi', api);
