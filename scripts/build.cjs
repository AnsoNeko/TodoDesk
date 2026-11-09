const { build } = require('esbuild');
require('./create-icon.cjs');
Promise.all([
  build({
    entryPoints: ['electron/main.ts'],
    outfile: 'dist-electron/main.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', 'electron-updater'],
  }),
  build({
    entryPoints: ['electron/preload.ts'],
    outfile: 'dist-electron/preload.cjs',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
  }),
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
