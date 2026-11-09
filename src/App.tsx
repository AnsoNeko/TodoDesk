import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Check,
  CheckCheck,
  Plus,
  Minus,
  X,
  Pin,
  PinOff,
  ArrowUpRight,
  LayoutGrid,
  CalendarDays,
  Clock,
  FileText,
  Settings2,
  Search,
  MoreHorizontal,
  Repeat2,
  Hash,
  TrendingUp,
  CheckCircle2,
  Circle,
  Pencil,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Copy,
  RefreshCw,
  FolderOpen,
  ChevronRight,
  LoaderCircle,
  AlertCircle,
  Inbox,
  ShieldCheck,
} from 'lucide-react';
import type { Command, Snapshot, TaskInput, TaskRecord, WindowAction } from '../shared/model';
import { UpdateSettings } from './UpdateSettings';

type Page = 'today' | 'history' | 'summary' | 'settings';
type Confirm = { title: string; text: string; danger?: boolean; action: () => Promise<void> };
const labels = { task: '普通任务', 'daily-counter': '每日计数', 'cumulative-counter': '累计计数' };
const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  });
const errorText = (error: unknown) =>
  String(error instanceof Error ? error.message : error).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

export function App() {
  const compact = new URLSearchParams(location.search).get('mode') === 'float';
  const [data, setData] = useState<Snapshot>();
  const [loadError, setLoadError] = useState('');
  const [page, setPage] = useState<Page>('today');
  const [selectedDate, setSelectedDate] = useState('');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<TaskRecord | 'new' | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [working, setWorking] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [dismissRecovery, setDismissRecovery] = useState(false);
  const notify = (text: string, error = false) => setNotice({ text, error });
  const run = async (command: Command) => {
    setWorking((n) => n + 1);
    try {
      const result = await window.todo.command(command);
      setData(result);
      return result;
    } catch (error) {
      notify(errorText(error), true);
      throw error;
    } finally {
      setWorking((n) => n - 1);
    }
  };
  const perform = (command: Command) => {
    void run(command).catch(() => {});
  };
  const control = (action: WindowAction) => {
    void window.todo.window(action).catch((error) => notify(errorText(error), true));
  };
  useEffect(() => {
    if (!window.todo) {
      setLoadError('请通过 TodoDesk 桌面程序打开此界面。');
      return;
    }
    const off = window.todo.onChange(setData);
    window.todo
      .command({ type: 'refresh' })
      .then(setData)
      .catch((error) => setLoadError(errorText(error)));
    const refresh = () =>
      window.todo
        .command({ type: 'refresh' })
        .then(setData)
        .catch((error) => notify(errorText(error), true));
    window.addEventListener('focus', refresh);
    return () => {
      off();
      window.removeEventListener('focus', refresh);
    };
  }, []);
  useEffect(() => {
    if (data) document.documentElement.dataset.theme = data.settings.theme;
  }, [data?.settings.theme]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (confirm) setConfirm(null);
        else setEditor(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [confirm]);

  if (!data)
    return (
      <div className="boot">
        <div className="brand-mark">
          <Check size={28} />
        </div>
        {loadError ? (
          <>
            <h2>暂时无法打开清单</h2>
            <p>{loadError}</p>
            <button className="button" onClick={() => location.reload()}>
              重新加载
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="spin" />
            <p>正在打开今日清单…</p>
          </>
        )}
      </div>
    );
  const date = page === 'history' || page === 'summary' ? selectedDate || data.today : data.today;
  const records = data.records.filter((r) => r.date === date && !r.removed);
  const todayRecords = data.records.filter((r) => r.date === data.today && !r.removed);
  const plannedRecords = data.records
    .filter((r) => r.date > data.today && !r.removed)
    .sort((a, b) => (a.startAt ?? a.date).localeCompare(b.startAt ?? b.date));
  const completed = records.filter((r) => r.completed).length;
  const todayDone = todayRecords.filter((r) => r.completed).length;
  const percent = records.length ? Math.round((completed / records.length) * 100) : 0;
  const days = [
    ...new Set([
      data.today,
      ...data.records.filter((r) => r.date <= data.today).map((r) => r.date),
      ...data.summaries.map((s) => s.date),
    ]),
  ]
    .sort()
    .reverse();
  const visible = records
    .filter(
      (r) =>
        (filter === 'all' || r.completed === (filter === 'done')) &&
        `${r.title} ${r.note}`.toLowerCase().includes(search.toLowerCase()),
    )
    .sort(
      (a, b) => Number(a.completed) - Number(b.completed) || a.createdAt.localeCompare(b.createdAt),
    );
  const storedSummary = data.summaries.find((s) => s.date === date);
  const summary = drafts[date] ?? storedSummary?.content ?? '';
  const summaryDirty = summary !== (storedSummary?.content ?? '');
  const go = (next: Page) => {
    setPage(next);
    setFilter('all');
    setSearch('');
  };
  const generate = async () => {
    await run({ type: 'generateSummary', date, overwrite: true });
    setDrafts((current) => {
      if (current[date] !== undefined && current[date] !== summary) return current;
      const next = { ...current };
      delete next[date];
      return next;
    });
    notify('日报已生成并保存');
  };
  const askGenerate = () => {
    if (storedSummary || summaryDirty)
      setConfirm({
        title: '重新生成这份日报？',
        text: '将根据该日任务记录重新生成，并覆盖已保存的内容和当前编辑。',
        action: generate,
      });
    else void generate().catch(() => {});
  };
  const renderTask = (record: TaskRecord, readOnly = false) => (
    <TaskRow
      key={record.id}
      record={record}
      compact={compact}
      readOnly={readOnly}
      planned={record.date > data.today}
      run={run}
      edit={() => setEditor(record)}
      remove={() =>
        setConfirm({
          title: '移除这个任务？',
          text: '任务将从清单移除，并停止每日重复。此前的历史记录和已保存总结会保留。',
          danger: true,
          action: async () => {
            await run({ type: 'archive', taskId: record.taskId });
            notify('任务已移除');
          },
        })
      }
    />
  );
  const recovery = data.recoveryNotice && !dismissRecovery && (
    <div className="recovery">
      <AlertCircle size={16} />
      <span>{data.recoveryNotice}</span>
      <IconButton label="关闭恢复提示" onClick={() => setDismissRecovery(true)}>
        <X size={15} />
      </IconButton>
    </div>
  );

  return (
    <div className={compact ? 'app compact' : 'app'}>
      {compact ? (
        <>
          <header className="float-title drag">
            <div className="brand-mark small">
              <Check size={18} />
            </div>
            <strong>今日清单</strong>
            <span className="float-controls no-drag">
              <IconButton
                label={data.settings.pinned ? '取消浮窗置顶' : '置顶浮窗'}
                active={data.settings.pinned}
                onClick={() => perform({ type: 'settings', pinned: !data.settings.pinned })}
              >
                {data.settings.pinned ? <Pin size={16} /> : <PinOff size={16} />}
              </IconButton>
              <IconButton label="打开完整面板" onClick={() => control('main')}>
                <ArrowUpRight size={17} />
              </IconButton>
              <IconButton label="隐藏到托盘" onClick={() => control('hide')}>
                <X size={17} />
              </IconButton>
            </span>
          </header>
          <div className="float-body">
            {recovery}
            <div className="float-heading">
              <div>
                <span className="eyebrow">TODAY</span>
                <h2>
                  {new Date(`${data.today}T12:00:00`).getMonth() + 1}月
                  {new Date(`${data.today}T12:00:00`).getDate()}日
                </h2>
              </div>
              <span className="count-pill">
                {todayDone}
                <span>/ {todayRecords.length} 完成</span>
              </span>
            </div>
            <div className="progress-track">
              <div
                style={{
                  width: `${todayRecords.length ? (todayDone / todayRecords.length) * 100 : 0}%`,
                }}
              />
            </div>
            <QuickAdd
              onAdd={async (title) => {
                await run({
                  type: 'create',
                  input: { title, note: '', kind: 'task', repeat: false, goal: null, unit: '' },
                });
              }}
            />
            <div className="float-task-list">
              {todayRecords.length ? (
                [...todayRecords]
                  .sort((a, b) => Number(a.completed) - Number(b.completed))
                  .map((r) => renderTask(r))
              ) : (
                <Empty compact title="今天，从一件小事开始" text="添加待办，也可以创建计数任务。" />
              )}
            </div>
            <button className="text-button add-special" onClick={() => setEditor('new')}>
              <Plus size={15} />
              添加计数 / 重复任务
            </button>
          </div>
          <footer className="float-footer">
            <span>
              <i className="status-dot" />
              {working ? '正在保存…' : '已自动保存'}
            </span>
            <button className="text-button" onClick={() => control('main')}>
              完整面板
              <ArrowUpRight size={14} />
            </button>
          </footer>
        </>
      ) : (
        <>
          <aside className="sidebar">
            <div className="brand drag">
              <div className="brand-mark">
                <Check size={24} />
              </div>
              <div>
                <strong>今日清单</strong>
                <span>TodoDesk</span>
              </div>
            </div>
            <span className="nav-caption">我的工作空间</span>
            <nav>
              {(
                [
                  ['today', LayoutGrid, '今日任务'],
                  ['history', CalendarDays, '历史记录'],
                  ['summary', FileText, '每日总结'],
                ] as const
              ).map(([key, Icon, label]) => (
                <button
                  key={key}
                  className={`nav-item ${page === key ? 'selected' : ''}`}
                  onClick={() => go(key)}
                >
                  <Icon size={19} />
                  <span>{label}</span>
                  {key === 'today' && <b>{todayRecords.length - todayDone}</b>}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <div className="desktop-card">
                <div className="desktop-icon">
                  <Monitor size={20} />
                </div>
                <strong>让清单留在眼前</strong>
                <p>
                  把小浮窗放在桌面，
                  <br />
                  随手记录每一点进展。
                </p>
                <button onClick={() => control('float')}>
                  打开桌面浮窗
                  <ArrowUpRight size={15} />
                </button>
              </div>
              <button
                className={`nav-item ${page === 'settings' ? 'selected' : ''}`}
                onClick={() => go('settings')}
              >
                <Settings2 size={19} />
                <span>设置</span>
              </button>
              <div className="local-status">
                <i className="status-dot" />
                本地存储 · 无需联网
              </div>
            </div>
          </aside>
          <section className="workspace">
            <header className="titlebar drag">
              <span>你的每一步，都算数。</span>
              <div className="no-drag title-actions">
                <IconButton label="打开桌面浮窗" onClick={() => control('float')}>
                  <Monitor size={17} />
                </IconButton>
                <span className="title-divider" />
                <IconButton label="最小化" onClick={() => control('minimize')}>
                  <Minus size={17} />
                </IconButton>
                <IconButton label="隐藏到托盘" onClick={() => control('hide')}>
                  <X size={17} />
                </IconButton>
              </div>
            </header>
            <main>
              {recovery}
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    {page === 'today'
                      ? 'A LITTLE PROGRESS, EVERY DAY'
                      : page === 'history'
                        ? 'YOUR DAILY FOOTPRINTS'
                        : page === 'summary'
                          ? 'MAKE YOUR PROGRESS VISIBLE'
                          : 'MAKE IT YOURS'}
                  </div>
                  <h1>
                    {
                      {
                        today: '今日任务',
                        history: '历史记录',
                        summary: '每日总结',
                        settings: '偏好设置',
                      }[page]
                    }
                    <span aria-hidden="true" className="heading-dot">
                      .
                    </span>
                  </h1>
                  <p>
                    {page === 'today'
                      ? dateLabel(data.today)
                      : page === 'history'
                        ? '回看走过的每一天，进展都有迹可循。'
                        : page === 'summary'
                          ? '把一天的努力，整理成一份清晰的工作日报。'
                          : '让今日清单，更适合你的工作习惯。'}
                  </p>
                </div>
                {page === 'today' && (
                  <button className="button primary" onClick={() => setEditor('new')}>
                    <Plus size={18} />
                    新建任务
                  </button>
                )}
                {(page === 'history' || page === 'summary') && (
                  <label className="date-select">
                    <CalendarDays size={16} />
                    <input
                      aria-label="选择日期"
                      type="date"
                      max={data.today}
                      value={date}
                      onChange={(e) => {
                        if (e.target.value) setSelectedDate(e.target.value);
                      }}
                    />
                  </label>
                )}
              </div>
              {page === 'today' || page === 'history' ? (
                <>
                  <div className="stats-grid">
                    <Stat
                      label="全部任务"
                      value={records.length}
                      icon={<LayoutGrid size={20} />}
                      detail={page === 'today' ? '今天值得完成的小事' : '该日清单记录'}
                    />
                    <Stat
                      label="已经完成"
                      value={completed}
                      icon={<CheckCheck size={21} />}
                      detail={completed ? '每一步，都有收获' : '准备好开始了吗'}
                      accent
                    />
                    <Stat
                      label="计数任务"
                      value={records.filter((r) => r.kind !== 'task').length}
                      icon={<TrendingUp size={21} />}
                      detail="把成果变成看得见的数字"
                    />
                  </div>
                  <div className="content-grid">
                    <section className="task-panel">
                      <div className="list-toolbar">
                        <div className="tabs">
                          {[
                            ['all', '全部'],
                            ['open', '待完成'],
                            ['done', '已完成'],
                          ].map(([key, label]) => (
                            <button
                              key={key}
                              className={filter === key ? 'active' : ''}
                              onClick={() => setFilter(key)}
                            >
                              {label}
                              <span>
                                {key === 'all'
                                  ? records.length
                                  : key === 'done'
                                    ? completed
                                    : records.length - completed}
                              </span>
                            </button>
                          ))}
                        </div>
                        <div className="search">
                          <Search size={16} />
                          <input
                            aria-label="搜索任务"
                            placeholder="搜索任务"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                          />
                        </div>
                      </div>
                      {page === 'today' && (
                        <QuickAdd
                          onAdd={async (title) => {
                            await run({
                              type: 'create',
                              input: {
                                title,
                                note: '',
                                kind: 'task',
                                repeat: false,
                                goal: null,
                                unit: '',
                              },
                            });
                          }}
                        />
                      )}
                      <div className="task-list">
                        {visible.length ? (
                          visible.map((r) => renderTask(r, page === 'history'))
                        ) : (
                          <Empty
                            title={
                              records.length
                                ? '这里暂时没有任务'
                                : page === 'history'
                                  ? '这一天还没有任务记录'
                                  : '给今天一个小小的开始'
                            }
                            text={
                              records.length
                                ? '试试切换筛选，或换个关键词。'
                                : page === 'history'
                                  ? '仅记录实际使用应用的日期，不补造空缺记录。'
                                  : '在上方输入待办，或新建一个计数目标。'
                            }
                          />
                        )}
                      </div>
                      <div className="list-footer">
                        <span>
                          {page === 'history'
                            ? '历史任务记录为只读'
                            : working
                              ? '正在保存更改…'
                              : '所有更改已自动保存到本地'}
                        </span>
                        <ShieldCheck size={14} />
                      </div>
                    </section>
                    <aside className="insights">
                      <section className="insight-card">
                        <div className="section-label">
                          {page === 'today' ? '今日进度' : '当日进度'}
                          <span>
                            {completed}/{records.length}
                          </span>
                        </div>
                        <div
                          className="progress-ring"
                          style={{
                            background: `conic-gradient(var(--accent) ${percent}%, var(--track) 0)`,
                          }}
                        >
                          <div>
                            <strong>
                              {percent}
                              <small>%</small>
                            </strong>
                            <span>任务完成率</span>
                          </div>
                        </div>
                        <p className="progress-caption">
                          {records.length && completed === records.length
                            ? '今日清单，全部完成。'
                            : '不必一次做完，先向前一步。'}
                        </p>
                        <div className="legend">
                          <span>
                            <i />
                            已完成
                          </span>
                          <span>
                            <i />
                            待完成
                          </span>
                        </div>
                      </section>
                      <section className="summary-callout">
                        <div className="summary-icon">
                          <FileText size={22} />
                        </div>
                        <h3>今天的努力，值得记录</h3>
                        <p>
                          将完成事项与数量成果，
                          <br />
                          一键整理为工作日报。
                        </p>
                        <button
                          className="button"
                          onClick={() => {
                            setSelectedDate(date);
                            go('summary');
                          }}
                        >
                          前往每日总结
                          <ChevronRight size={16} />
                        </button>
                      </section>
                      {page === 'history' && (
                        <section className="recent-dates">
                          <span className="section-label">有记录的日期</span>
                          {days.slice(0, 6).map((d) => (
                            <button
                              className={date === d ? 'active' : ''}
                              key={d}
                              onClick={() => setSelectedDate(d)}
                            >
                              {d}
                              <ChevronRight size={14} />
                            </button>
                          ))}
                        </section>
                      )}
                    </aside>
                  </div>
                  {page === 'today' && plannedRecords.length > 0 && (
                    <section className="task-panel planned-panel" aria-label="计划任务">
                      <header className="list-toolbar">
                        <h2>计划任务</h2>
                      </header>
                      <div className="task-list">{plannedRecords.map((r) => renderTask(r))}</div>
                    </section>
                  )}
                </>
              ) : page === 'summary' ? (
                <div className="summary-layout">
                  <section className="summary-editor">
                    <header>
                      <div>
                        <FileText size={18} />
                        <strong>{date} 工作日报</strong>
                      </div>
                      <span className={`save-indicator ${summaryDirty ? 'dirty' : ''}`}>
                        <i />
                        {summaryDirty ? '有未保存的编辑' : storedSummary ? '已保存' : '尚未生成'}
                      </span>
                    </header>
                    <textarea
                      aria-label="日报内容"
                      placeholder={
                        '点击“生成日报”，把今天的任务和成果整理到这里。\n\n生成后可自由编辑，再保存或复制。'
                      }
                      value={summary}
                      onChange={(e) =>
                        setDrafts((current) => ({ ...current, [date]: e.target.value }))
                      }
                      maxLength={200000}
                    />
                    <footer>
                      <span>{summary.length.toLocaleString()} 字符</span>
                      <div>
                        <button
                          className="button"
                          disabled={!summary}
                          onClick={() =>
                            void window.todo
                              .copy(summary)
                              .then(() => notify('日报已复制到剪贴板'))
                              .catch((error) => notify(errorText(error), true))
                          }
                        >
                          <Copy size={16} />
                          复制
                        </button>
                        <button
                          className="button primary"
                          disabled={!summaryDirty || !!working}
                          onClick={() =>
                            void run({ type: 'saveSummary', date, content: summary })
                              .then(() => {
                                setDrafts((current) => {
                                  if (current[date] !== summary) return current;
                                  const next = { ...current };
                                  delete next[date];
                                  return next;
                                });
                                notify('日报已保存');
                              })
                              .catch(() => {})
                          }
                        >
                          保存修改
                        </button>
                      </div>
                    </footer>
                  </section>
                  <aside className="insights">
                    <section className="insight-card summary-guide">
                      <span className="eyebrow">DAILY REPORT</span>
                      <h3>一份日报，三部分</h3>
                      <ol>
                        <li>
                          <span>01</span>
                          <div>
                            <strong>今日完成</strong>
                            <p>已勾选完成的任务</p>
                          </div>
                        </li>
                        <li>
                          <span>02</span>
                          <div>
                            <strong>数量成果</strong>
                            <p>当日净变化、当前值与目标</p>
                          </div>
                        </li>
                        <li>
                          <span>03</span>
                          <div>
                            <strong>待跟进事项</strong>
                            <p>留在清单里的未完成任务</p>
                          </div>
                        </li>
                      </ol>
                      <button className="button primary" disabled={!!working} onClick={askGenerate}>
                        <RefreshCw size={16} />
                        {storedSummary ? '重新生成日报' : '生成日报'}
                      </button>
                      <p className="muted fine-print">
                        离线生成，无需配置 AI 服务。
                        <br />
                        生成时自动保存，编辑后请点击保存。
                      </p>
                    </section>
                    <section className="recent-dates">
                      <span className="section-label">已保存的日报</span>
                      {data.summaries.length ? (
                        [...data.summaries]
                          .sort((a, b) => b.date.localeCompare(a.date))
                          .slice(0, 12)
                          .map((s) => (
                            <button
                              className={date === s.date ? 'active' : ''}
                              key={s.date}
                              onClick={() => setSelectedDate(s.date)}
                            >
                              {s.date}
                              <ChevronRight size={14} />
                            </button>
                          ))
                      ) : (
                        <p className="muted fine-print">你的第一份日报，将从这里开始。</p>
                      )}
                    </section>
                  </aside>
                </div>
              ) : (
                <section className="settings-panel">
                  <div className="settings-section">
                    <h3>外观</h3>
                    <p>选择让你感到舒适的界面。</p>
                    <div className="theme-options">
                      {(['light', 'dark'] as const).map((theme) => (
                        <button
                          key={theme}
                          className={`theme-option ${data.settings.theme === theme ? 'active' : ''}`}
                          onClick={() => perform({ type: 'settings', theme })}
                        >
                          <div className={`theme-preview ${theme}`}>
                            <i />
                            <div>
                              <b />
                              <b />
                              <b />
                            </div>
                          </div>
                          <span>
                            {theme === 'light' ? <Sun size={17} /> : <Moon size={17} />}{' '}
                            {theme === 'light' ? '简洁浅色' : '静谧深色'}
                            {data.settings.theme === theme && <CheckCircle2 size={17} />}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>桌面浮窗置顶</h3>
                      <p>让浮窗保持在其他普通窗口之上。</p>
                    </div>
                    <button
                      role="switch"
                      aria-label="桌面浮窗置顶"
                      aria-checked={data.settings.pinned}
                      className={`switch ${data.settings.pinned ? 'on' : ''}`}
                      onClick={() => perform({ type: 'settings', pinned: !data.settings.pinned })}
                    >
                      <i />
                    </button>
                  </div>
                  <div className="setting-row">
                    <div>
                      <h3>本地数据</h3>
                      <p>任务、历史与日报保存在此电脑，关闭窗口后继续保留。</p>
                      <code>{data.storagePath}</code>
                    </div>
                    <button className="button" onClick={() => control('openDataFolder')}>
                      <FolderOpen size={16} />
                      打开目录
                    </button>
                  </div>
                  <UpdateSettings
                    summaryDirty={Object.entries(drafts).some(
                      ([day, content]) =>
                        content !== (data.summaries.find((s) => s.date === day)?.content ?? ''),
                    )}
                  />
                  <div className="settings-note">
                    <AlertCircle size={17} />
                    <p>
                      关闭窗口会隐藏到系统托盘。需要彻底退出时，请在托盘菜单选择“退出 TodoDesk”。
                    </p>
                  </div>
                </section>
              )}
            </main>
            <footer className="workspace-footer">
              <span>
                <i className="status-dot" />
                {working ? '正在保存…' : '本地数据已就绪'}
              </span>
              <span>一步一步，也是一种很好的速度。</span>
            </footer>
          </section>
        </>
      )}
      {editor && (
        <TaskEditor
          record={editor === 'new' ? undefined : editor}
          today={data.today}
          close={() => setEditor(null)}
          save={async (input) => {
            const result = await run(
              editor === 'new'
                ? { type: 'create', input }
                : { type: 'edit', taskId: editor.taskId, input },
            );
            setEditor(null);
            if (input.startDate && input.startDate > result.today)
              notify(`任务已安排在 ${input.startDate}`);
            else notify(editor === 'new' ? '任务已添加' : '任务已更新');
          }}
        />
      )}
      {confirm && (
        <Modal close={() => setConfirm(null)} title={confirm.title}>
          <p className="confirm-text">{confirm.text}</p>
          <div className="modal-actions">
            <button className="button" disabled={!!working} onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className={`button ${confirm.danger ? 'danger' : 'primary'}`}
              disabled={!!working}
              onClick={() =>
                void confirm
                  .action()
                  .then(() => setConfirm(null))
                  .catch(() => {})
              }
            >
              {working ? '处理中…' : '确认'}
            </button>
          </div>
        </Modal>
      )}
      {notice && (
        <div
          className={`toast ${notice.error ? 'error' : ''}`}
          role={notice.error ? 'alert' : 'status'}
        >
          {notice.error ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
          <span>{notice.text}</span>
          <IconButton label="关闭消息" onClick={() => setNotice(null)}>
            <X size={15} />
          </IconButton>
        </div>
      )}
    </div>
  );
}

function TaskRow({
  record: r,
  compact,
  readOnly,
  planned,
  run,
  edit,
  remove,
}: {
  record: TaskRecord;
  compact: boolean;
  readOnly: boolean;
  planned: boolean;
  run: (command: Command) => Promise<Snapshot>;
  edit: () => void;
  remove: () => void;
}) {
  const [value, setValue] = useState(String(r.value));
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [menu, setMenu] = useState(false);
  const [pending, setPending] = useState(false);
  const timeLabel = (value: string) =>
    planned || value.slice(0, 10) !== r.date ? value.replace('T', ' ') : value.slice(11);
  useEffect(() => {
    if (!editing) setValue(String(r.value));
  }, [r.value, editing]);
  const saveCount = async () => {
    if (!/^\d{1,9}$/.test(value)) {
      setInvalid(true);
      return;
    }
    try {
      await run({ type: 'counterSet', taskId: r.taskId, value: Number(value) });
      setEditing(false);
      setInvalid(false);
    } catch {
      setValue(String(r.value));
      setEditing(false);
    }
  };
  return (
    <article
      className={`task-row ${r.completed ? 'completed' : ''} ${r.kind !== 'task' ? 'has-counter' : ''}`}
      data-task-title={r.title}
    >
      <button
        className="task-checkbox"
        aria-label={`${r.completed ? '撤销完成' : '完成'}：${r.title}`}
        aria-pressed={r.completed}
        disabled={readOnly || planned || pending}
        onClick={() => {
          setPending(true);
          void run({ type: 'complete', taskId: r.taskId, completed: !r.completed })
            .catch(() => {})
            .finally(() => setPending(false));
        }}
      >
        {r.completed && <Check size={15} strokeWidth={3} />}
      </button>
      <div className="task-content">
        <div className="task-title-line">
          <span className="task-title">{r.title}</span>
          {r.repeat && (
            <span title="每日重复" className="repeat-icon">
              <Repeat2 size={13} />
            </span>
          )}
        </div>
        {r.note && <p className="task-note">{r.note}</p>}
        <div className="task-meta">
          <span className={`type-tag ${r.kind !== 'task' ? 'counter' : ''}`}>
            {r.kind === 'task' ? (
              <Circle size={10} />
            ) : r.kind === 'daily-counter' ? (
              <Hash size={11} />
            ) : (
              <TrendingUp size={11} />
            )}{' '}
            {labels[r.kind]}
          </span>
          {r.kind === 'task' && r.repeat && <span>每日重复</span>}
          {r.goal && (
            <span className={r.value >= r.goal ? 'goal-met' : ''}>
              {r.value >= r.goal ? '目标已达成' : `目标 ${r.goal}${r.unit}`}
            </span>
          )}
          {r.completed && <span className="done-label">已完成</span>}
          {r.startAt && r.dueAt && (
            <span className="task-schedule">
              <Clock size={12} aria-hidden="true" />
              <span>
                开始 <time dateTime={r.startAt}>{timeLabel(r.startAt)}</time>
              </span>
              <span>
                截止 <time dateTime={r.dueAt}>{timeLabel(r.dueAt)}</time>
              </span>
            </span>
          )}
        </div>
        {r.kind !== 'task' && !planned && (
          <div className="counter-area">
            <div className="counter-control">
              <button
                aria-label={`${r.title} 减一`}
                disabled={readOnly || r.value === 0 || editing}
                onClick={() =>
                  void run({ type: 'counterDelta', taskId: r.taskId, delta: -1 }).catch(() => {})
                }
              >
                <Minus size={15} />
              </button>
              <input
                type="text"
                inputMode="numeric"
                aria-label={`${r.title} 数量`}
                value={editing ? value : r.value}
                disabled={readOnly}
                aria-invalid={invalid}
                onFocus={() => {
                  setEditing(true);
                  setValue(String(r.value));
                }}
                onChange={(event) => {
                  setValue(event.target.value);
                  setInvalid(false);
                }}
                onBlur={() => {
                  if (editing) void saveCount();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur();
                  if (event.key === 'Escape') {
                    setEditing(false);
                    setInvalid(false);
                    setValue(String(r.value));
                  }
                }}
              />
              <button
                aria-label={`${r.title} 加一`}
                disabled={readOnly || r.value === 999999999 || editing}
                onClick={() =>
                  void run({ type: 'counterDelta', taskId: r.taskId, delta: 1 }).catch(() => {})
                }
              >
                <Plus size={15} />
              </button>
            </div>
            <span className="counter-unit">
              {r.goal ? `/ ${r.goal}` : ''} {r.unit}
            </span>
            {r.goal && !compact && (
              <div className="counter-progress">
                <div style={{ width: `${Math.min(100, (r.value / r.goal) * 100)}%` }} />
              </div>
            )}
            {invalid && <span className="input-error">请输入 0～999999999 的整数</span>}
          </div>
        )}
      </div>
      {!readOnly && (
        <div className="row-menu">
          <IconButton label={`更多：${r.title}`} onClick={() => setMenu(!menu)}>
            <MoreHorizontal size={18} />
          </IconButton>
          {menu && (
            <>
              <button
                className="menu-backdrop"
                aria-label="关闭任务菜单"
                onClick={() => setMenu(false)}
              />
              <div className="dropdown">
                <button
                  onClick={() => {
                    setMenu(false);
                    edit();
                  }}
                >
                  <Pencil size={14} />
                  编辑任务
                </button>
                <button
                  className="danger-text"
                  onClick={() => {
                    setMenu(false);
                    remove();
                  }}
                >
                  <Trash2 size={14} />
                  移除任务
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </article>
  );
}
function QuickAdd({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(title.trim());
      setTitle('');
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="quick-add" onSubmit={submit}>
      <Plus size={18} />
      <input
        aria-label="快速添加任务"
        placeholder="添加一件今天想做的事…"
        maxLength={120}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        disabled={busy}
      />
      <button disabled={busy || !title.trim()} aria-label="添加任务">
        {busy ? <LoaderCircle className="spin" size={16} /> : <span>↵</span>}
      </button>
    </form>
  );
}
function TaskEditor({
  record,
  today,
  close,
  save,
}: {
  record?: TaskRecord;
  today: string;
  close: () => void;
  save: (input: TaskInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(record?.title ?? '');
  const [note, setNote] = useState(record?.note ?? '');
  const [kind, setKind] = useState<TaskInput['kind']>(record?.kind ?? 'task');
  const [repeat, setRepeat] = useState(record?.repeat ?? false);
  const [goal, setGoal] = useState(record?.goal?.toString() ?? '');
  const [unit, setUnit] = useState(record?.unit ?? '');
  const initialStartDate = record?.startAt?.slice(0, 10) ?? record?.date ?? '';
  const initialDueDate = record?.dueAt?.slice(0, 10);
  const [startDate, setStartDate] = useState(initialStartDate);
  const [startTime, setStartTime] = useState(record?.startAt?.slice(11) ?? '');
  const [dueDate, setDueDate] = useState(
    initialDueDate === initialStartDate ? '' : (initialDueDate ?? ''),
  );
  const [dueTime, setDueTime] = useState(record?.dueAt?.slice(11) ?? '');
  const selectedStartDate = startDate || today;
  const canPickStartDate = !record || record.date > today;
  const saveSchedule = !record || record.startAt || startTime || dueDate || dueTime;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError('请输入任务标题');
      return;
    }
    if (kind !== 'task' && goal && (!/^\d{1,9}$/.test(goal) || Number(goal) < 1)) {
      setError('目标请输入 1～999999999 的整数，或留空');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await save({
        title: title.trim(),
        note: note.trim(),
        kind,
        repeat: kind === 'daily-counter' || (kind === 'task' && repeat),
        goal: kind !== 'task' && goal ? Number(goal) : null,
        unit: kind === 'task' ? '' : unit.trim(),
        startDate: saveSchedule ? startDate || undefined : undefined,
        startTime: startTime || undefined,
        dueDate: dueDate || undefined,
        dueTime: dueTime || undefined,
      });
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title={record ? '编辑任务' : '新建任务'} close={close}>
      <form onSubmit={submit}>
        <label className="field">
          任务名称
          <input
            autoFocus
            required
            maxLength={120}
            placeholder="例如：完成项目方案、处理客户工单"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <div className="field schedule-fields">
          <div className="field-pair">
            <label className="field">
              开始日期
              <input
                type="date"
                required
                min={canPickStartDate ? today : undefined}
                max="9999-12-31"
                readOnly={!canPickStartDate}
                value={selectedStartDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="field">
              开始时间
              <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </label>
            <label className="field">
              截止日期
              <input
                type="date"
                required
                min={selectedStartDate}
                max="9999-12-31"
                value={dueDate || selectedStartDate}
                onChange={(e) =>
                  setDueDate(e.target.value === selectedStartDate ? '' : e.target.value)
                }
              />
            </label>
            <label className="field">
              截止时间
              <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} />
            </label>
          </div>
          <small>
            {selectedStartDate === today ? '开始时间留空时取保存时刻' : '开始时间留空时取 00:00'}
            ，截止时间留空时取所选日期的 23:59。
          </small>
        </div>
        <div className="field">
          <span>任务类型</span>
          <div className="type-picker">
            {(['task', 'daily-counter', 'cumulative-counter'] as const).map((k) => (
              <button
                type="button"
                disabled={!!record}
                className={kind === k ? 'selected' : ''}
                key={k}
                onClick={() => setKind(k)}
              >
                {k === 'task' ? (
                  <CheckCheck size={18} />
                ) : k === 'daily-counter' ? (
                  <Hash size={18} />
                ) : (
                  <TrendingUp size={18} />
                )}
                <span>{labels[k]}</span>
              </button>
            ))}
          </div>
          <small>
            {record
              ? '类型和重复规则在创建后固定；需要更改时请新建任务。'
              : kind === 'daily-counter'
                ? '每天从 0 开始，保留各天记录；完成状态手动勾选。'
                : kind === 'cumulative-counter'
                  ? '跨天保留总数，日报记录当天净变化。'
                  : '一次性任务未完成会继续留在待办中。'}
          </small>
        </div>
        {kind !== 'task' && (
          <div className="field-pair">
            <label className="field">
              目标数量 <span className="optional">选填</span>
              <input
                inputMode="numeric"
                placeholder="不限目标"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label className="field">
              计数单位 <span className="optional">选填</span>
              <input
                placeholder="条、篇、次…"
                maxLength={12}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </label>
          </div>
        )}
        {kind === 'task' && (
          <label className="repeat-setting">
            <input
              type="checkbox"
              checked={repeat}
              disabled={!!record}
              onChange={(e) => setRepeat(e.target.checked)}
            />
            <Repeat2 size={16} />
            <span>
              每日重复<small>每天生成独立记录</small>
            </span>
          </label>
        )}
        <label className="field">
          备注 <span className="optional">选填</span>
          <textarea
            placeholder="补充一点说明…"
            maxLength={2000}
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="button" disabled={busy} onClick={close}>
            取消
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? '正在保存…' : record ? '保存修改' : '创建任务'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const target =
      ref.current?.querySelector<HTMLElement>('input:not([disabled]),textarea:not([disabled])') ??
      ref.current?.querySelector<HTMLElement>('button');
    target?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        className="modal"
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            const items = Array.from(
              ref.current?.querySelectorAll<HTMLElement>(
                'button:not([disabled]),input:not([disabled]),textarea:not([disabled])',
              ) ?? [],
            );
            if (e.shiftKey && document.activeElement === items[0]) {
              e.preventDefault();
              items.at(-1)?.focus();
            } else if (!e.shiftKey && document.activeElement === items.at(-1)) {
              e.preventDefault();
              items[0]?.focus();
            }
          }
        }}
      >
        <header>
          <h2>{title}</h2>
          <IconButton label="关闭对话框" onClick={close}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </div>
  );
}
function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''}`}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
function Empty({ title, text, compact }: { title: string; text: string; compact?: boolean }) {
  return (
    <div className={`empty ${compact ? 'small' : ''}`}>
      <div>
        <Inbox size={compact ? 25 : 32} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Stat({
  label,
  value,
  icon,
  detail,
  accent,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  detail: string;
  accent?: boolean;
}) {
  return (
    <section className={`stat-card ${accent ? 'accent' : ''}`}>
      <div>
        <span>{label}</span>
        <strong>
          {value}
          <small>项</small>
        </strong>
        <p>{detail}</p>
      </div>
      <div className="stat-icon">{icon}</div>
    </section>
  );
}
