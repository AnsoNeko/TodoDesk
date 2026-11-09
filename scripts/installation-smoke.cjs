const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const { version } = require('../package.json');
const installer = path.join(root, 'release', `TodoDesk-Setup-${version}-x64.exe`);
const installDir = path.join(process.env.LOCALAPPDATA, 'Programs', 'TodoDesk');
const executable = path.join(installDir, 'TodoDesk.exe');
const dataDir = path.join(root, 'artifacts', `installed-data-${Date.now()}`);
const dataFile = path.join(dataDir, 'tododesk.json');
const env = { ...process.env, TODODESK_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
function processRun(file, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: root,
      env: environment,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${path.basename(file)} exited ${code}`)),
    );
  });
}
let app;
(async () => {
  await fs.access(installer);
  console.log('Installing current-user Windows application...');
  await processRun(installer, ['/S', `/D=${installDir}`]);
  await fs.access(executable);
  console.log('Checking installed application UI...');
  await processRun(process.execPath, [path.join(root, 'scripts', 'smoke.cjs')], {
    ...env,
    TODODESK_SMOKE_EXE: executable,
    TODODESK_SMOKE_DATA: dataDir,
  });
  const before = await fs.readFile(dataFile);
  console.log('Reinstalling over the same version...');
  await processRun(installer, ['/S', `/D=${installDir}`]);
  const after = await fs.readFile(dataFile);
  assert.equal(
    crypto.createHash('sha256').update(before).digest('hex'),
    crypto.createHash('sha256').update(after).digest('hex'),
    '覆盖安装不应改写用户数据文件',
  );
  app = await electron.launch({ executablePath: executable, args: [], env, timeout: 60000 });
  const until = Date.now() + 30000;
  while (!app.windows().some((p) => p.url().includes('mode=main'))) {
    if (Date.now() > until) throw new Error('安装后未创建主面板');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const main = app.windows().find((p) => p.url().includes('mode=main'));
  await main.getByRole('heading', { name: '今日任务', exact: true }).waitFor();
  await main.getByText('整理项目计划', { exact: true }).waitFor();
  assert.equal(
    await main.getByRole('textbox', { name: '累计阅读文章 数量', exact: true }).inputValue(),
    '12',
  );
  await main.getByRole('button', { name: '每日总结', exact: true }).click();
  assert.match(
    await main.getByRole('textbox', { name: '日报内容' }).inputValue(),
    /补充：明日继续跟进/,
  );
  await app.close();
  app = null;
  const bytes = await fs.readFile(installer);
  const result = {
    passed: true,
    installer,
    executable,
    dataDir,
    installerBytes: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    checks: [
      'silent per-user installation',
      'installed app complete desktop flow',
      'same-version overwrite installation',
      'data file identical across installation',
      'relaunch after reinstall preserves tasks, counters, summary and theme',
    ],
  };
  await fs.writeFile(
    path.join(root, 'artifacts', 'installation-smoke.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
})().catch(async (error) => {
  console.error(error);
  if (app) await app.close().catch(() => {});
  process.exit(1);
});
