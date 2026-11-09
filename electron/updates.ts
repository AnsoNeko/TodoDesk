import { app } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { autoUpdater } from 'electron-updater';
import type { UpdateState } from '../shared/model';

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
      if (state.status === 'downloading' && progress !== state.progress)
        set({ ...state, progress });
    });
    autoUpdater.on('error', (error) => {
      if (state.status === 'installing') fail('无法启动更新安装，请重新检查更新。', error);
    });
  }

  const check = async () => {
    set({ status: 'checking' });
    let version: string;
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        set({ status: 'current' });
        return;
      }
      version = result.updateInfo.version;
    } catch (error) {
      fail('无法检查更新，请确认可以访问 GitHub 后重试。', error);
      return;
    }
    set({ status: 'downloading', version, progress: 0 });
    try {
      await autoUpdater.downloadUpdate();
      set({ status: 'ready', version });
    } catch (error) {
      fail('下载或校验失败，请重新检查更新后重试。', error);
    }
  };

  if (supported) {
    setTimeout(() => {
      if (state.status === 'idle') void check();
    }, 3000).unref();
  }

  return async (action: unknown): Promise<UpdateState> => {
    if (!supported) return state;
    const { status, version } = state;
    if (action === 'check' && ['idle', 'current', 'error'].includes(status)) {
      await check();
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
