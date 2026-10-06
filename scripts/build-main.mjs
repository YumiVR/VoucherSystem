import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const production = process.env.NODE_ENV === 'production' || process.argv.includes('--production');

const common = {
  absWorkingDir: root,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: production ? false : 'linked',
  minify: production,
  legalComments: 'none',
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
};

await build({
  ...common,
  entryPoints: { main: 'src/main/main.ts' },
  outdir: 'dist/main',
  outExtension: { '.js': '.cjs' },
  external: ['electron', 'node:sqlite'],
});

await build({
  ...common,
  entryPoints: { preload: 'src/preload/index.ts' },
  outdir: 'dist/main',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
});
