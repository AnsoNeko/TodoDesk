import { app, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/model';

const releases = 'https://github.com/AnsoNeko/TodoDesk/releases/latest';

export function createUpdates(publish: (state: UpdateState) => void, flush: () => Promise<void>) {
  const supported =
    app.isPackaged &&
    process.platform === 'win32' &&
    existsSync(path.join(path.dirname(process.execPath), 'Uninstall TodoDesk.exe'));
  const currentVersion = app.getVersion();
  let state: UpdateState = { currentVersion, status: supported ? 'idle' : 'unavailable' };
  const set = (next: Omit<UpdateState, 'currentVersion'>) => {
    state = { ...next, currentVersion };
    publish(state);
  };
  const fail = (message: string, error: unknown) => {
    console.error(message, error);
    set({ status: 'error', message });
  };
  if (supported) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowPrerelease = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.on('download-progress', ({ percent }) => {
      const progress = Math.floor(percent);
      if (state.status === 'downloading' && progress !== state.progress) set({ ...state, progress });
    });
    autoUpdater.on('error', (error) => {
      if (state.status === 'installing') fail('无法启动更新安装，请重新检查更新。', error);
    });
  }

  return async (action: unknown): Promise<UpdateState> => {
    if (action === 'status') return state;
    if (action === 'releases') {
      await shell.openExternal(releases);
      return state;
    }
    if (!supported) return state;
    const { status, version } = state;
    if (action === 'check' && ['idle', 'current', 'error', 'available'].includes(status)) {
      set({ status: 'checking' });
      try {
        const result = await autoUpdater.checkForUpdates();
        set(
          result?.isUpdateAvailable
            ? { status: 'available', version: result.updateInfo.version }
            : { status: 'current' },
        );
      } catch (error) {
        fail('无法检查更新，请确认可以访问 GitHub 后重试。', error);
      }
    } else if (action === 'download' && status === 'available') {
      set({ status: 'downloading', version, progress: 0 });
      try {
        await autoUpdater.downloadUpdate();
        set({ status: 'ready', version });
      } catch (error) {
        fail('下载或校验失败，请重新检查更新后重试。', error);
      }
    } else if (action === 'install' && status === 'ready') {
      set({ status: 'installing', version });
      try {
        await flush();
        autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        fail('无法启动更新安装，请重新检查更新。', error);
      }
    }
    return state;
  };
}
