import { randomUUID } from 'node:crypto';
import {
  commandSchema,
  dateKey,
  type Store,
  type Command,
  type Snapshot,
  type TaskInput,
  type TaskRecord,
  type Bounds,
} from '../shared/model';
import type { Repository } from './repository';

type Task = Store['tasks'][number];

function resolveSchedule(
  { startDate, startTime, dueDate, dueTime, ...fields }: TaskInput,
  now: Date,
  defaultDate: string,
) {
  const day = startDate ?? defaultDate;
  const currentTime = now.toTimeString().slice(0, 5);
  const startAt = `${day}T${startTime ?? (day === dateKey(now) ? currentTime : '00:00')}`;
  const dueAt = `${dueDate ?? day}T${dueTime ?? '23:59'}`;
  if (dueAt < startAt) throw new Error('截止时间不能早于开始时间');
  return { ...fields, startAt, dueAt };
}

function recordForDay(task: Task, date: string): TaskRecord {
  const { id: taskId, archivedAt: _archived, ...fields } = task;
  let { startAt, dueAt } = task;
  if (task.repeat && startAt && dueAt) {
    const firstDay = Date.parse(startAt.slice(0, 10));
    const deadlineOffset = Date.parse(dueAt.slice(0, 10)) - firstDay;
    const deadlineDay = new Date(Date.parse(date) + deadlineOffset).toISOString().slice(0, 10);
    startAt = date + startAt.slice(10);
    dueAt = deadlineDay + dueAt.slice(10);
  }
  return {
    ...fields,
    startAt,
    dueAt,
    id: randomUUID(),
    taskId,
    date,
    value: task.kind === 'daily-counter' ? 0 : task.value,
    completed: false,
    completedAt: null,
    removed: false,
  };
}

export class TodoService {
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private constructor(
    private repo: Repository,
    private state: Store,
    private now: () => Date,
  ) {}
  static async open(repo: Repository, now = () => new Date()) {
    const service = new TodoService(repo, await repo.load(dateKey(now())), now);
    await service.command({ type: 'refresh' });
    return service;
  }
  snapshot(): Snapshot {
    return {
      ...structuredClone(this.state),
      today: dateKey(this.now()),
      storagePath: this.repo.file,
      recoveryNotice: this.repo.recoveryNotice,
    };
  }
  subscribe(listener: (snapshot: Snapshot) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private queue(action: (draft: Store, now: Date) => void): Promise<Snapshot> {
    const next = this.tail.then(async () => {
      const draft = structuredClone(this.state);
      const now = this.now();
      this.materialize(draft, dateKey(now));
      action(draft, now);
      if (JSON.stringify(draft) !== JSON.stringify(this.state)) {
        await this.repo.save(draft);
        this.state = draft;
        const snapshot = this.snapshot();
        this.listeners.forEach((listener) => {
          try {
            listener(structuredClone(snapshot));
          } catch (error) {
            console.error('窗口同步失败', error);
          }
        });
      }
      return this.snapshot();
    });
    this.tail = next.catch(() => {});
    return next;
  }
  private materialize(s: Store, today: string) {
    s.activeDate = today;
    for (const task of s.tasks) {
      if (task.archivedAt || (!task.repeat && task.completed)) continue;
      if (task.startAt && task.startAt.slice(0, 10) > today) continue;
      if (s.records.some((r) => r.taskId === task.id && r.date === today)) continue;
      s.records.push(recordForDay(task, today));
    }
  }
  command(raw: Command): Promise<Snapshot> {
    const command = commandSchema.parse(raw);
    return this.queue((s, clock) => {
      const now = clock.toISOString();
      const today = s.activeDate;
      if (command.type === 'refresh') return;
      if (command.type === 'settings') {
        if (command.theme !== undefined) s.settings.theme = command.theme;
        if (command.pinned !== undefined) s.settings.pinned = command.pinned;
        return;
      }
      if (command.type === 'create') {
        const date = command.input.startDate ?? today;
        if (date < today) throw new Error('请选择今天或未来的开始日期');
        const task: Task = {
          ...resolveSchedule(command.input, clock, date),
          id: randomUUID(),
          createdAt: now,
          archivedAt: null,
          completed: false,
          value: 0,
        };
        s.tasks.push(task);
        s.records.push(recordForDay(task, date));
        return;
      }
      if (command.type === 'generateSummary' || command.type === 'saveSummary') {
        if (command.date > today) throw new Error('不能生成未来日期的总结');
        const existing = s.summaries.find((v) => v.date === command.date);
        if (command.type === 'generateSummary' && existing && !command.overwrite)
          throw new Error('此日期已有总结，请确认后重新生成');
        const content =
          command.type === 'saveSummary' ? command.content : buildSummary(s, command.date);
        if (existing) {
          existing.content = content;
          existing.updatedAt = now;
          if (command.type === 'generateSummary') existing.generatedAt = now;
        } else s.summaries.push({ date: command.date, content, generatedAt: now, updatedAt: now });
        return;
      }
      const task = s.tasks.find((t) => t.id === command.taskId && !t.archivedAt);
      const scheduledDate = task?.startAt?.slice(0, 10);
      const planned = scheduledDate !== undefined && scheduledDate > today;
      const canManagePlan = command.type === 'edit' || command.type === 'archive';
      const recordDate = planned && canManagePlan ? scheduledDate : today;
      const record = s.records.find(
        (r) => r.taskId === command.taskId && r.date === recordDate && !r.removed,
      );
      if (!task || !record) throw new Error('任务已移除或不在今日清单中，请刷新后重试');
      if (command.type === 'edit') {
        const { startDate, startTime, dueDate, dueTime, ...fields } = command.input;
        if (fields.kind !== task.kind || fields.repeat !== task.repeat)
          throw new Error('任务创建后不能更改类型或重复规则，请新建任务');
        const currentStartDate = record.startAt?.slice(0, 10) ?? record.date;
        if (startDate && (planned ? startDate < today : startDate !== currentStartDate))
          throw new Error(
            planned ? '请选择今天或未来的开始日期' : '任务已进入今日清单，开始日期已固定',
          );
        const updated =
          startDate || startTime || dueDate || dueTime
            ? resolveSchedule(command.input, clock, currentStartDate)
            : fields;
        Object.assign(task, updated);
        Object.assign(record, updated);
        if (planned && startDate) record.date = startDate;
        return;
      }
      if (command.type === 'archive') {
        task.archivedAt = now;
        record.removed = true;
        return;
      }
      if (command.type === 'complete') {
        record.completed = command.completed;
        record.completedAt = command.completed ? now : null;
        task.completed = command.completed;
        return;
      }
      if (task.kind === 'task') throw new Error('普通任务不能修改计数');
      const value =
        command.type === 'counterSet' ? command.value : Math.max(0, record.value + command.delta);
      if (!Number.isSafeInteger(value) || value < 0 || value > 999999999)
        throw new Error('计数范围为 0～999999999');
      const delta = value - record.value;
      if (delta === 0) return;
      record.value = value;
      task.value = value;
      s.changes.push({
        id: randomUUID(),
        taskId: task.id,
        recordId: record.id,
        date: today,
        delta,
        value,
        at: now,
      });
    });
  }
  updateBounds(window: 'main' | 'float', bounds: Bounds) {
    return this.queue((s) => {
      s.settings.windows[window] = bounds;
    });
  }
  async flush() {
    await this.tail;
  }
}

export function buildSummary(s: Store, date: string) {
  const records = s.records.filter((r) => r.date === date && !r.removed);
  const done = records.filter((r) => r.completed);
  const pending = records.filter((r) => !r.completed);
  const title = (r: TaskRecord) => r.title.replace(/[\r\n]+/g, ' ');
  const counters = records
    .filter((r) => r.kind !== 'task')
    .map((r) => {
      const delta = s.changes
        .filter((c) => c.recordId === r.id && c.date === date)
        .reduce((a, c) => a + c.delta, 0);
      return `- ${title(r)}：今日净变化 ${delta > 0 ? '+' : ''}${delta}${r.unit}；${r.kind === 'cumulative-counter' ? '累计' : '当前'} ${r.value}${r.unit}${r.goal ? ` / 目标 ${r.goal}${r.unit}` : ''}${r.completed ? '（已完成）' : ''}`;
    });
  return `${date} 工作日报\n\n一、今日完成（${done.length}/${records.length}）\n${done.length ? done.map((r) => `- ${title(r)}`).join('\n') : '- 暂无已完成事项'}\n\n二、数量成果\n${counters.length ? counters.join('\n') : '- 暂无计数事项'}\n\n三、待跟进事项\n${pending.length ? pending.map((r) => `- ${title(r)}`).join('\n') : '- 暂无待跟进事项'}`;
}
