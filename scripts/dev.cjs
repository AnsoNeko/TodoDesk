const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const { createServer } = require('vite');
(async () => {
  require('./create-icon.cjs');
  await Promise.all([
    build({
      entryPoints: ['electron/main.ts'],
      outfile: 'dist-electron/main.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    }),
    build({
      entryPoints: ['electron/preload.ts'],
      outfile: 'dist-electron/preload.cjs',
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
    }),
  ]);
  const server = await createServer();
  await server.listen();
  const env = { ...process.env, TODODESK_DEV_URL: 'http://127.0.0.1:5173' };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['.'], { stdio: 'inherit', env, windowsHide: true });
  child.on('exit', async (code) => {
    await server.close();
    process.exit(code || 0);
  });
  process.on('SIGINT', () => child.kill());
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
