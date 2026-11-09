import type { UpdateAction, UpdateState } from '../shared/model';

export function UpdateSettings({
  state,
  summaryDirty,
  onAction,
}: {
  state?: UpdateState;
  summaryDirty: boolean;
  onAction: (action: UpdateAction) => void;
}) {
  const status = state?.status;
  const details = {
    unavailable: '安装 Windows 版本后可在应用内更新。',
    idle: '启动后自动检查更新。',
    checking: '正在检查更新…',
    current: '已是最新版本。',
    downloading: `正在下载 v${state?.version} · ${state?.progress ?? 0}%`,
    ready: summaryDirty
      ? '更新已下载。请先保存未保存的日报，再安装并重启。'
      : `v${state?.version} 已下载并校验，可以安装。`,
    installing: '正在安装更新，稍后自动重启…',
    error: state?.message,
  };
  const ready = status === 'ready';
  const busy = status === 'checking' || status === 'downloading' || status === 'installing';

  return (
    <div className="setting-row update-settings">
      <div>
        <h3>软件更新{state && ` · v${state.currentVersion}`}</h3>
        <p role="status">{status ? details[status] : '正在读取版本…'}</p>
        {status === 'downloading' && (
          <progress aria-label="更新下载进度" max={100} value={state?.progress ?? 0} />
        )}
      </div>
      {status !== 'unavailable' && (
        <button
          className={`button ${ready ? 'primary' : ''}`}
          disabled={!state || busy || (ready && summaryDirty)}
          onClick={() => onAction(ready ? 'install' : 'check')}
        >
          {ready ? '重启安装' : '检查更新'}
        </button>
      )}
    </div>
  );
}
