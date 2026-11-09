import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  Tray,
  nativeImage,
  screen,
  protocol,
  net,
  powerMonitor,
  dialog,
  clipboard,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TodoService } from './service';
import { JsonRepository } from './repository';
import { visibleBounds } from '../shared/window-bounds';
import { createUpdates } from './updates';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
app.setName('TodoDesk');
app.setAppUserModelId('local.tododesk.app');
if (process.env.TODODESK_DATA_DIR)
  app.setPath('userData', path.resolve(process.env.TODODESK_DATA_DIR));
let service: TodoService;
let tray: Tray | undefined;
let quitting = false;
const windows: Partial<Record<'main' | 'float', BrowserWindow>> = {};
const boundsTimers = new Map<string, ReturnType<typeof setTimeout>>();
const icon = path.join(__dirname, '../assets/icon.ico');
const devUrl =
  !app.isPackaged && process.env.TODODESK_DEV_URL === 'http://127.0.0.1:5173'
    ? process.env.TODODESK_DEV_URL
    : undefined;

function trusted(event: IpcMainInvokeEvent) {
  const owner = Object.values(windows).find(
    (w) => w && !w.isDestroyed() && w.webContents === event.sender,
  );
  if (!owner || event.senderFrame !== event.sender.mainFrame) throw new Error('不允许的请求来源');
  const url = new URL(event.senderFrame.url);
  if (
    !(url.protocol === 'app:' && url.hostname === 'tododesk') &&
    !(devUrl && url.origin === devUrl)
  )
    throw new Error('不允许的请求来源');
}
function windowBounds(
  compact: boolean,
  saved = service.snapshot().settings.windows[compact ? 'float' : 'main'],
) {
  return visibleBounds(
    saved,
    [
      screen.getPrimaryDisplay(),
      ...screen.getAllDisplays().filter((d) => d.id !== screen.getPrimaryDisplay().id),
    ].map((d) => d.workArea),
    compact,
  );
}
function captureBounds(kind: 'main' | 'float') {
  const win = windows[kind];
  if (!win || win.isDestroyed() || win.isMinimized() || win.isMaximized()) return;
  const bounds = win.getBounds();
  return service
    .updateBounds(kind, bounds)
    .catch((error) => console.error('窗口位置保存失败', error));
}
function openWindow(kind: 'main' | 'float') {
  const existing = windows[kind];
  if (existing && !existing.isDestroyed()) {
    existing.setBounds(windowBounds(kind === 'float', existing.getBounds()));
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return existing;
  }
  const compact = kind === 'float';
  const win = new BrowserWindow({
    ...windowBounds(compact),
    minWidth: compact ? 320 : 760,
    minHeight: compact ? 360 : 540,
    title: compact ? '今日清单 · 浮窗' : '今日清单 · TodoDesk',
    frame: false,
    backgroundColor: service.snapshot().settings.theme === 'dark' ? '#171e21' : '#f7f9f8',
    alwaysOnTop: compact && service.snapshot().settings.pinned,
    show: false,
    icon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  windows[kind] = win;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.once('ready-to-show', () => win.show());
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
      void captureBounds(kind);
    }
  });
  const moved = () => {
    clearTimeout(boundsTimers.get(kind));
    boundsTimers.set(
      kind,
      setTimeout(() => void captureBounds(kind), 600),
    );
  };
  win.on('moved', moved);
  win.on('resized', moved);
  if (devUrl) void win.loadURL(`${devUrl}/?mode=${kind}`);
  else void win.loadURL(`app://tododesk/index.html?mode=${kind}`);
  return win;
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示桌面浮窗', click: () => openWindow('float') },
      { label: '打开今日清单', click: () => openWindow('main') },
      { type: 'separator' },
      {
        label: '浮窗置顶',
        type: 'checkbox',
        checked: service.snapshot().settings.pinned,
        click: (item) => {
          void service
            .command({ type: 'settings', pinned: item.checked })
            .catch((error) => dialog.showErrorBox('保存失败', String(error)));
        },
      },
      { type: 'separator' },
      { label: '退出 TodoDesk', click: () => app.quit() },
    ]),
  );
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (service) openWindow('main');
  });
  app
    .whenReady()
    .then(async () => {
      const root = path.resolve(__dirname, '../dist');
      protocol.handle('app', (request) => {
        const url = new URL(request.url);
        const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
        if (url.hostname !== 'tododesk' || !file.startsWith(root + path.sep))
          return new Response('Not found', { status: 404 });
        return net.fetch(pathToFileURL(file).toString());
      });
      service = await TodoService.open(
        new JsonRepository(path.join(app.getPath('userData'), 'tododesk.json')),
      );
      const update = createUpdates(
        (state) => {
          const win = windows.main;
          if (win && !win.isDestroyed()) win.webContents.send('todo:update-state', state);
        },
        () => service.flush(),
      );
      ipcMain.handle('todo:update', async (event, action) => {
        trusted(event);
        if (event.sender !== windows.main?.webContents) throw new Error('请在完整面板管理更新');
        return update(action);
      });
      ipcMain.handle('todo:command', async (event, command) => {
        trusted(event);
        return service.command(command);
      });
      ipcMain.handle('todo:copy', (event, text) => {
        trusted(event);
        if (typeof text !== 'string' || text.length > 200000) throw new Error('文本无效');
        clipboard.writeText(text);
      });
      ipcMain.handle('todo:window', async (event, action) => {
        trusted(event);
        const owner = BrowserWindow.fromWebContents(event.sender);
        if (action === 'main' || action === 'float') {
          openWindow(action);
          return;
        }
        if (action === 'hide') owner?.hide();
        else if (action === 'minimize') owner?.minimize();
        else if (action === 'quit') app.quit();
        else if (action === 'openDataFolder') await shell.openPath(app.getPath('userData'));
        else throw new Error('窗口操作无效');
      });
      let lastPin = service.snapshot().settings.pinned;
      service.subscribe((snapshot) => {
        if (lastPin !== snapshot.settings.pinned) {
          lastPin = snapshot.settings.pinned;
          windows.float?.setAlwaysOnTop(lastPin);
          updateTray();
        }
        Object.values(windows).forEach((win) => {
          if (win && !win.isDestroyed()) win.webContents.send('todo:changed', snapshot);
        });
      });
      tray = new Tray(
        nativeImage
          .createFromPath(path.join(__dirname, '../assets/icon.png'))
          .resize({ width: 20, height: 20 }),
      );
      tray.setToolTip('今日清单 · TodoDesk');
      tray.on('double-click', () => openWindow('float'));
      updateTray();
      openWindow('main');
      openWindow('float');
      const refresh = () =>
        void service
          .command({ type: 'refresh' })
          .catch((error) => dialog.showErrorBox('无法更新日期', String(error)));
      setInterval(refresh, 15000).unref();
      powerMonitor.on('resume', refresh);
      const reposition = () =>
        Object.entries(windows).forEach(([kind, win]) => {
          if (win && !win.isDestroyed())
            win.setBounds(windowBounds(kind === 'float', win.getBounds()));
        });
      screen.on('display-removed', reposition);
      screen.on('display-metrics-changed', reposition);
    })
    .catch((error) => {
      dialog.showErrorBox('TodoDesk 无法启动', String(error));
      app.exit(1);
    });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    boundsTimers.forEach(clearTimeout);
    void Promise.all([captureBounds('main'), captureBounds('float')])
      .then(() => service?.flush())
      .finally(() => {
        tray?.destroy();
        app.exit(0);
      });
  });
  app.on('window-all-closed', () => {});
  app.on('activate', () => {
    if (service) openWindow('main');
  });
}
