import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const r = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

// The React refresh preamble is inline, so the development server needs a looser script policy than production.
const devCsp = (): Plugin => ({
  name: 'dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html
      .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
      .replace("connect-src 'self'", "connect-src 'self' ws://localhost:*"),
});

export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  plugins: [react(), devCsp()],
  resolve: {
    alias: { '@shared': r('./src/shared') },
  },
  build: {
    outDir: r('./dist/renderer'),
    emptyOutDir: true,
    target: 'chrome140',
    assetsInlineLimit: 0,
  },
  server: { port: 5173, strictPort: true },
});
