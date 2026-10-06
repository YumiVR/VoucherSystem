import { app, BrowserWindow, Menu, protocol, session, type IpcMainInvokeEvent } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { openDatabase } from './database/db';
import type { Role } from '../shared/constants/index';
import { createHandlersContext } from './bootstrap';
import { registerIpc } from './ipc/register';
import { cleanupTempFiles, createUiHooks } from './ipc/ui';
import { ElectronSecretProtector } from './services/electronProtector';

const APP_ORIGIN = 'app://voucher';
const devServerUrl = !app.isPackaged ? process.env.VITE_DEV_SERVER_URL : undefined;
let mainWindow: BrowserWindow | null = null;

function parseLaunchRole(): Role | null {
  const arg = process.argv.find((a) => a.startsWith('--role='));
  const value = arg?.slice('--role='.length);
  return value === 'issuer' || value === 'redeemer' ? value : null;
}

const launchRole = parseLaunchRole();

// Development only: each role gets its own profile so two instances never share keys or databases.
if (!app.isPackaged && launchRole) {
  app.setPath('userData', join(app.getPath('appData'), launchRole === 'issuer' ? 'VoucherRedeem-Issuer' : 'VoucherRedeem-Redeemer'));
}

// A privileged scheme lets the renderer fetch its bundled WebAssembly decoder, which file:// pages cannot do.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

function appRoot(): string {
  return app.getAppPath();
}

function isOwnUrl(url: string): boolean {
  if (devServerUrl && url.startsWith(devServerUrl)) return true;
  return url.startsWith(`${APP_ORIGIN}/`);
}

function serveRenderer(): void {
  const rendererDir = join(appRoot(), 'dist', 'renderer');
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.host !== 'voucher') return new Response('Not found', { status: 404 });
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = normalize(join(rendererDir, relative));
    if (!target.startsWith(rendererDir + sep)) return new Response('Forbidden', { status: 403 });
    try {
      const body = await readFile(target);
      return new Response(new Uint8Array(body), { headers: { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' } });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    title: 'Voucher Redeem',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(appRoot(), 'dist', 'main', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!isOwnUrl(url)) e.preventDefault();
  });
  void mainWindow.loadURL(devServerUrl ?? `${APP_ORIGIN}/index.html`);
}

function lockDownSession(): void {
  const ses = session.defaultSession;
  // Only our own pages may use the camera; everything else is denied.
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    const videoOnly = mediaTypes.length > 0 && mediaTypes.every((t) => t === 'video');
    callback(permission === 'media' && videoOnly && isOwnUrl(wc.getURL()));
  });
  ses.setPermissionCheckHandler((wc, permission) => permission === 'media' && !!wc && isOwnUrl(wc.getURL()));
  // Nothing in the application needs the network; refuse everything except our own pages and the dev server.
  ses.webRequest.onBeforeRequest((details, callback) => {
    const u = details.url;
    const allowed =
      isOwnUrl(u) ||
      u.startsWith('devtools:') ||
      u.startsWith('data:') ||
      u.startsWith('blob:') ||
      (!app.isPackaged && u.startsWith('ws://localhost'));
    callback({ cancel: !allowed });
  });
}

async function main(): Promise<void> {
  // Production keeps a single instance; development allows an Issuer and a Redeemer side by side.
  if (app.isPackaged && !app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.enableSandbox();
  if (app.isPackaged) {
    app.on('second-instance', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (ev) => ev.preventDefault());
  });
  await app.whenReady();
  Menu.setApplicationMenu(null);
  lockDownSession();
  serveRenderer();

  const base = app.isPackaged ? process.resourcesPath : appRoot();
  const db = openDatabase(join(app.getPath('userData'), 'voucher-redeem.db'), join(base, 'migrations'));
  const ctx = createHandlersContext({
    db,
    protector: new ElectronSecretProtector(),
    fontsDir: app.isPackaged ? join(base, 'fonts') : join(base, 'assets', 'fonts'),
    ui: createUiHooks(() => mainWindow),
    launchRole,
  });
  registerIpc(ctx, {
    isTrustedSender: (event: IpcMainInvokeEvent) => {
      const url = event.senderFrame?.url ?? '';
      return event.sender === mainWindow?.webContents && isOwnUrl(url);
    },
  });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('will-quit', () => {
    cleanupTempFiles();
    db.close();
  });
}

main().catch((err: unknown) => {
  console.error('Fatal start-up error:', err instanceof Error ? err.name : 'unknown');
  app.exit(1);
});
