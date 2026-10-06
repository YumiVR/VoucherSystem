import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);
const electronPath = require('electron');

const roleArg = process.argv.find((a) => a.startsWith('--role='));
const role = roleArg?.slice('--role='.length);
if (roleArg && role !== 'issuer' && role !== 'redeemer') throw new Error('Use --role=issuer or --role=redeemer');
// Separate ports let an Issuer and a Redeemer run their dev servers side by side.
const port = role === 'redeemer' ? 5174 : 5173;

await new Promise((resolve, reject) => {
  const p = spawn(process.execPath, ['scripts/build-main.mjs'], { cwd: root, stdio: 'inherit' });
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`build exited with ${code}`))));
});

const server = await createServer({
  configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
  server: { port, strictPort: true },
});
await server.listen();
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('Vite dev server did not start');

const child = spawn(electronPath, ['.', ...(roleArg ? [roleArg] : [])], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
