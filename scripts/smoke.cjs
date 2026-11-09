const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts');
const dataDir = process.env.TODODESK_SMOKE_DATA || path.join(output, `smoke-data-${Date.now()}`);
const executable = process.env.TODODESK_SMOKE_EXE;
const env = { ...process.env, TODODESK_DATA_DIR: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.TODODESK_DEV_URL;
let app;
let originalClipboard;
async function capture(kind, filename) {
  const png = await app.evaluate(async ({ BrowserWindow }, kind) => {
    const win = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes(`mode=${kind}`),
    );
    const image = await win.capturePage();
    return image.toPNG().toString('base64');
  }, kind);
  await fs.writeFile(path.join(output, filename), Buffer.from(png, 'base64'));
}
async function launch() {
  app = await electron.launch({
    ...(executable ? { executablePath: executable, args: [] } : { args: [root] }),
    env,
    timeout: 60000,
  });
  const until = Date.now() + 30000;
  while (app.windows().length < 2) {
    if (Date.now() > until) throw new Error('未创建两个桌面窗口');
    await new Promise((r) => setTimeout(r, 100));
  }
  const main = app.windows().find((p) => p.url().includes('mode=main')) || app.windows()[0];
  const floating = app.windows().find((p) => p !== main);
  await main.getByRole('heading', { name: '今日任务', exact: true }).waitFor();
  await floating.getByText('添加计数 / 重复任务').waitFor();
  return { main, floating };
}
async function value(locator, expected) {
  const until = Date.now() + 12000;
  while ((await locator.inputValue()) !== String(expected)) {
    if (Date.now() > until) throw new Error(`计数未达到 ${expected}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}
async function create(main, title, kind, goal, unit, repeat = false) {
  await main.getByRole('button', { name: '新建任务', exact: true }).click();
  const modal = main.getByRole('dialog');
  await modal.getByRole('textbox', { name: '任务名称' }).fill(title);
  if (kind) await modal.getByRole('button', { name: kind, exact: true }).click();
  if (goal) await modal.getByRole('textbox', { name: /目标数量/ }).fill(String(goal));
  if (unit) await modal.getByRole('textbox', { name: /计数单位/ }).fill(unit);
  if (repeat) await modal.getByRole('checkbox', { name: /每日重复/ }).check();
  await modal.getByRole('button', { name: '创建任务', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
}
(async () => {
  await fs.mkdir(output, { recursive: true });
  const errors = [];
  let { main, floating } = await launch();
  originalClipboard = await app.evaluate(({ clipboard }) => clipboard.readText());
  for (const p of [main, floating]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('response', (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
  }
  await main.screenshot({ path: path.join(output, '01-empty.png') });
  await main.getByRole('textbox', { name: '快速添加任务' }).fill('整理项目计划');
  await main.getByRole('textbox', { name: '快速添加任务' }).press('Enter');
  await floating.getByText('整理项目计划', { exact: true }).waitFor();
  const quickTask = main.locator('[data-task-title="整理项目计划"]');
  await quickTask.locator('time').last().waitFor();
  assert.equal(await quickTask.locator('time').last().textContent(), '23:59');

  const future = new Date();
  future.setDate(future.getDate() + 2);
  const plannedDate = [
    future.getFullYear(),
    String(future.getMonth() + 1).padStart(2, '0'),
    String(future.getDate()).padStart(2, '0'),
  ].join('-');
  await main.getByRole('button', { name: '新建任务', exact: true }).click();
  const plannedEditor = main.getByRole('dialog');
  await plannedEditor.getByRole('textbox', { name: '任务名称' }).fill('预定项目评审');
  await plannedEditor.getByLabel('开始日期', { exact: true }).fill(plannedDate);
  await plannedEditor.getByLabel('开始时间', { exact: true }).fill('14:35');
  assert.equal(
    await plannedEditor.getByLabel('截止日期', { exact: true }).inputValue(),
    plannedDate,
  );
  await plannedEditor.getByLabel('截止时间', { exact: true }).fill('14:30');
  await plannedEditor.getByRole('button', { name: '创建任务', exact: true }).click();
  await plannedEditor.getByText('截止时间不能早于开始时间', { exact: true }).waitFor();
  await plannedEditor.getByLabel('截止时间', { exact: true }).fill('16:20');
  await plannedEditor.getByRole('button', { name: '创建任务', exact: true }).click();
  await plannedEditor.waitFor({ state: 'hidden' });
  const plannedTask = main
    .getByRole('region', { name: '计划任务' })
    .locator('[data-task-title="预定项目评审"]');
  await plannedTask.waitFor();
  assert.deepEqual(await plannedTask.locator('time').allTextContents(), [
    `${plannedDate} 14:35`,
    `${plannedDate} 16:20`,
  ]);
  assert.equal(await floating.getByText('预定项目评审', { exact: true }).count(), 0);

  await create(main, '处理客户工单', '每日计数', 3, '条');
  for (let i = 0; i < 3; i++)
    await floating.getByRole('button', { name: '处理客户工单 加一', exact: true }).click();
  await value(main.getByRole('textbox', { name: '处理客户工单 数量', exact: true }), 3);
  assert.equal(
    await main
      .getByRole('button', { name: '完成：处理客户工单', exact: true })
      .getAttribute('aria-pressed'),
    'false',
  );
  await main.getByRole('textbox', { name: '处理客户工单 数量', exact: true }).fill('10');
  await main.getByRole('heading', { name: '今日任务', exact: true }).click();
  await value(floating.getByRole('textbox', { name: '处理客户工单 数量', exact: true }), 10);
  await floating.getByRole('button', { name: '处理客户工单 减一', exact: true }).click();
  await value(main.getByRole('textbox', { name: '处理客户工单 数量', exact: true }), 9);
  await main.getByRole('button', { name: '完成：处理客户工单', exact: true }).click();
  await floating.getByRole('button', { name: '撤销完成：处理客户工单', exact: true }).waitFor();
  await create(main, '累计阅读文章', '累计计数', 30, '篇');
  await main.getByRole('textbox', { name: '累计阅读文章 数量', exact: true }).fill('12');
  await main.getByRole('heading', { name: '今日任务', exact: true }).click();
  await value(floating.getByRole('textbox', { name: '累计阅读文章 数量', exact: true }), 12);
  await create(main, '每日复盘', undefined, undefined, undefined, true);
  await main.getByRole('button', { name: '更多：每日复盘', exact: true }).click();
  await main.getByRole('button', { name: '编辑任务', exact: true }).click();
  await main.getByRole('dialog').getByRole('textbox', { name: '任务名称' }).fill('整理明日安排');
  await main.getByRole('dialog').getByRole('button', { name: '保存修改', exact: true }).click();
  await main.getByRole('dialog').waitFor({ state: 'hidden' });
  await floating.getByText('整理明日安排', { exact: true }).waitFor();
  await create(main, '临时测试任务');
  await main.getByRole('button', { name: '更多：临时测试任务', exact: true }).click();
  await main.getByRole('button', { name: '移除任务', exact: true }).click();
  await main.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
  await main.getByRole('dialog').waitFor({ state: 'hidden' });
  await floating.getByText('临时测试任务', { exact: true }).waitFor({ state: 'hidden' });
  if (await main.getByRole('button', { name: '关闭消息', exact: true }).count())
    await main.getByRole('button', { name: '关闭消息', exact: true }).click();
  await main.locator('main').evaluate((el) => {
    el.scrollTop = 0;
  });
  await capture('main', '02-today.png');
  await capture('float', '03-floating.png');
  await main.getByRole('button', { name: '每日总结', exact: true }).click();
  await main.getByRole('button', { name: '生成日报', exact: true }).click();
  const report = main.getByRole('textbox', { name: '日报内容' });
  await valueText(report, /净变化 \+9条/);
  await report.fill((await report.inputValue()) + '\n\n补充：明日继续跟进。');
  await main.getByRole('button', { name: '保存修改', exact: true }).click();
  await main.getByText('已保存', { exact: true }).waitFor();
  await main.getByRole('button', { name: '复制', exact: true }).click();
  assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /补充：明日继续跟进/);
  if (await main.getByRole('button', { name: '关闭消息', exact: true }).count())
    await main.getByRole('button', { name: '关闭消息', exact: true }).click();
  await main.screenshot({ path: path.join(output, '04-report.png') });
  await main.getByRole('button', { name: '重新生成日报', exact: true }).click();
  await main.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.match(await report.inputValue(), /补充：明日继续跟进/);
  await main.getByRole('button', { name: '历史记录', exact: true }).click();
  assert.equal(
    await main.getByRole('button', { name: '完成：整理项目计划', exact: true }).isDisabled(),
    true,
  );
  await main.getByRole('button', { name: '设置', exact: true }).click();
  await main.getByRole('heading', { name: /软件更新 · v\d+\.\d+\.\d+/ }).waitFor();
  assert.equal(await main.getByRole('button', { name: '发布页面', exact: true }).count(), 0);
  await main.getByRole('button', { name: '静谧深色', exact: true }).click();
  await main.locator('html[data-theme="dark"]').waitFor();
  await floating.locator('html[data-theme="dark"]').waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('mode=float'))
        .isAlwaysOnTop(),
    ),
    true,
  );
  await main.getByRole('switch', { name: '桌面浮窗置顶' }).click();
  await main.locator('[role="switch"][aria-checked="false"]').waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('mode=float'))
        .isAlwaysOnTop(),
    ),
    false,
  );
  await main.getByRole('button', { name: /今日任务/ }).click();
  await main.screenshot({ path: path.join(output, '05-dark.png') });
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('mode=main'),
    );
    w.setSize(760, 540);
  });
  await new Promise((r) => setTimeout(r, 300));
  await main.screenshot({ path: path.join(output, '06-small-window.png') });
  assert.equal(
    await main.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('mode=main'),
    );
    w.setSize(1140, 780);
    w.webContents.setZoomFactor(1.25);
  });
  await new Promise((r) => setTimeout(r, 300));
  await capture('main', '07-scale-125.png');
  assert.equal(
    await main.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
    false,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('mode=main'),
    );
    w.webContents.setZoomFactor(1);
    w.setPosition(-5000, -5000);
  });
  await floating.getByRole('button', { name: '打开完整面板', exact: true }).click();
  const recovered = await app.evaluate(({ BrowserWindow, screen }) => {
    const b = BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('mode=main'))
      .getBounds();
    return screen
      .getAllDisplays()
      .some(
        (d) =>
          b.x >= d.workArea.x &&
          b.y >= d.workArea.y &&
          b.x + b.width <= d.workArea.x + d.workArea.width &&
          b.y + b.height <= d.workArea.y + d.workArea.height,
      );
  });
  assert.equal(recovered, true);
  await main.getByRole('button', { name: '隐藏到托盘', exact: true }).click();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('mode=main'))
        .isVisible(),
    ),
    false,
  );
  await floating.getByRole('button', { name: '打开完整面板', exact: true }).click();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('mode=main'))
        .isVisible(),
    ),
    true,
  );
  assert.equal(await main.evaluate(() => typeof window.require), 'undefined');
  await main.getByRole('button', { name: '隐藏到托盘', exact: true }).click();
  await new Promise((resolve, reject) => {
    const second = spawn(executable || require('electron'), executable ? [] : [root], {
      env,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      second.kill();
      reject(new Error('重复启动未退出第二进程'));
    }, 10000);
    second.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    second.once('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`第二实例退出码 ${code}`));
    });
  });
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('mode=main'))
        .isVisible(),
    ),
    true,
  );
  assert.equal(app.windows().length, 2);
  await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard);
  await app.close();
  ({ main, floating } = await launch());
  await main.getByText('整理项目计划', { exact: true }).waitFor();
  await main
    .getByRole('region', { name: '计划任务' })
    .getByText('预定项目评审', { exact: true })
    .waitFor();
  await value(main.getByRole('textbox', { name: '累计阅读文章 数量', exact: true }), 12);
  await main.locator('html[data-theme="dark"]').waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().includes('mode=float'))
        .isAlwaysOnTop(),
    ),
    false,
  );
  await main.getByRole('button', { name: '每日总结', exact: true }).click();
  await valueText(main.getByRole('textbox', { name: '日报内容' }), /补充：明日继续跟进/);
  await app.close();
  app = null;
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    executable: executable || 'development Electron',
    dataDir,
    screenshots: output,
    checks: [
      'two-window sync',
      'quick add',
      'minute schedule defaults, validation and calendar planning',
      'create/edit/remove/repeat',
      'counter +/- and direct edit',
      'manual completion',
      'daily report save/copy/overwrite confirmation',
      'read-only history',
      'light/dark sync',
      'native always-on-top',
      'resize',
      '125% layout',
      'offscreen recovery',
      'hide and restore',
      'single-instance restore',
      'isolated renderer',
      'restart persistence',
    ],
  };
  await fs.writeFile(
    path.join(output, executable ? 'installed-smoke.json' : 'desktop-smoke.json'),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
})().catch(async (error) => {
  console.error(error);
  if (app) {
    if (originalClipboard !== undefined)
      await app
        .evaluate(({ clipboard }, text) => clipboard.writeText(text), originalClipboard)
        .catch(() => {});
    for (const [i, p] of app.windows().entries())
      await p.screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
    await app.close().catch(() => {});
  }
  process.exit(1);
});
async function valueText(locator, pattern) {
  const until = Date.now() + 12000;
  while (!pattern.test(await locator.inputValue())) {
    if (Date.now() > until) throw new Error(`内容未匹配 ${pattern}`);
    await new Promise((r) => setTimeout(r, 80));
  }
}
