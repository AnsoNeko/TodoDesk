import { useEffect, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { UpdateAction, UpdateState } from '../shared/model';

export function UpdateSettings({ summaryDirty }: { summaryDirty: boolean }) {
  const [state, setState] = useState<UpdateState>();
  const [error, setError] = useState('');
  const request = (action: UpdateAction) => {
    setError('');
    void window.todo
      .update(action)
      .then(setState)
      .catch(() => setError('更新操作失败，请重试。'));
  };
  useEffect(() => {
    const off = window.todo.onUpdate(setState);
    request('status');
    return off;
  }, []);

  const status = state?.status;
  const details = {
    unavailable: '安装 Windows 版本后可在应用内更新。',
    idle: '通过 GitHub Releases 获取新版。',
    checking: '正在检查更新…',
    current: '已是最新版本。',
    available: `发现新版本 v${state?.version}。`,
    downloading: `正在下载 v${state?.version} · ${state?.progress ?? 0}%`,
    ready: summaryDirty
      ? '更新已下载。请先保存未保存的日报，再安装并重启。'
      : `v${state?.version} 已下载并校验，可以安装。`,
    installing: '正在安装更新，稍后自动重启…',
    error: state?.message,
  };
  const action =
    status === 'available'
      ? { type: 'download' as const, label: '下载更新' }
      : status === 'ready'
        ? { type: 'install' as const, label: '安装并重启' }
        : { type: 'check' as const, label: '检查更新' };
  const busy = status === 'checking' || status === 'downloading' || status === 'installing';

  return (
    <div className="setting-row update-settings">
      <div>
        <h3>软件更新{state && ` · v${state.currentVersion}`}</h3>
        <p role="status">{error || (status ? details[status] : '正在读取版本…')}</p>
        {status === 'downloading' && (
          <progress aria-label="更新下载进度" max={100} value={state?.progress ?? 0} />
        )}
      </div>
      <div className="update-actions">
        {status !== 'unavailable' && (
          <button
            className="button"
            disabled={!state || busy || (status === 'ready' && summaryDirty)}
            onClick={() => request(action.type)}
          >
            {action.label}
          </button>
        )}
        <button className="button" onClick={() => request('releases')}>
          发布页面 <ArrowUpRight size={15} />
        </button>
      </div>
    </div>
  );
}
