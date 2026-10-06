import { BrowserWindow, dialog, shell } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_BACKUP_BYTES } from '../backup/backup';
import type { UiHooks } from './handlers';

const tempDir = join(tmpdir(), `voucher-redeem-${randomBytes(6).toString('hex')}`);

export function cleanupTempFiles(): void {
  rmSync(tempDir, { recursive: true, force: true });
}

export function createUiHooks(getWindow: () => BrowserWindow | null): UiHooks {
  const win = (): BrowserWindow | undefined => getWindow() ?? undefined;
  return {
    async savePdf(defaultName, bytes) {
      const opts = { defaultPath: defaultName, filters: [{ name: 'PDF document', extensions: ['pdf'] }] };
      const r = win() ? await dialog.showSaveDialog(win()!, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return false;
      writeFileSync(r.filePath, bytes, { mode: 0o600 });
      return true;
    },

    async openForPrint(defaultName, bytes) {
      mkdirSync(tempDir, { recursive: true, mode: 0o700 });
      const file = join(tempDir, `${randomBytes(4).toString('hex')}-${defaultName.replace(/[^A-Za-z0-9._-]/g, '_')}`);
      writeFileSync(file, bytes, { mode: 0o600 });
      const error = await shell.openPath(file);
      return error === '';
    },

    async saveBackup(defaultName, bytes) {
      const opts = { defaultPath: defaultName, filters: [{ name: 'Voucher Redeem backup', extensions: ['vrbackup'] }] };
      const r = win() ? await dialog.showSaveDialog(win()!, opts) : await dialog.showSaveDialog(opts);
      if (r.canceled || !r.filePath) return false;
      writeFileSync(r.filePath, bytes, { mode: 0o600 });
      return true;
    },

    async openBackup() {
      const opts = {
        properties: ['openFile' as const],
        filters: [{ name: 'Voucher Redeem backup', extensions: ['vrbackup'] }],
      };
      const r = win() ? await dialog.showOpenDialog(win()!, opts) : await dialog.showOpenDialog(opts);
      const file = r.filePaths[0];
      if (r.canceled || !file) return null;
      if (statSync(file).size > MAX_BACKUP_BYTES) throw new Error('Backup too large');
      return readFileSync(file);
    },
  };
}
