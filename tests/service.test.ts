import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TodoService } from '../electron/service';
import { JsonRepository, type Repository } from '../electron/repository';
import { dateKey, emptyStore, commandSchema, type Store, type TaskInput } from '../shared/model';
import { visibleBounds } from '../shared/window-bounds';

class MemoryRepo implements Repository {
  file = '/test/tododesk.json';
  state?: Store;
  fail = false;
  saves = 0;
  async load(date: string) {
    return structuredClone(this.state ?? emptyStore(date));
  }
  async save(store: Store) {
    if (this.fail) throw new Error('disk unavailable');
    this.state = structuredClone(store);
    this.saves++;
  }
}
const input = (extra: Partial<TaskInput> = {}): TaskInput => ({
  title: '任务',
  note: '',
  kind: 'task',
  repeat: false,
  goal: null,
  unit: '',
  ...extra,
});
async function fixture() {
  const repo = new MemoryRepo();
  let time = new Date(2026, 9, 29, 10, 0);
  const service = await TodoService.open(repo, () => time);
  const create = async (extra: Partial<TaskInput> = {}) => {
    const s = await service.command({ type: 'create', input: input(extra) });
    return s.tasks.at(-1)!.id;
  };
  return {
    repo,
    service,
    create,
    nextDay: (day = 30) => {
      time = new Date(2026, 9, day, 8, 0);
    },
  };
}
test('普通任务完成与撤销，不修改创建日期', async () => {
  const { service, create } = await fixture();
  const id = await create();
  await service.command({ type: 'complete', taskId: id, completed: true });
  assert.equal(service.snapshot().records[0].completed, true);
  await service.command({ type: 'complete', taskId: id, completed: false });
  assert.equal(service.snapshot().records[0].completedAt, null);
});
test('任务按本地分钟计算默认时间，支持跨日截止并拒绝倒置时间', async () => {
  const { service, create } = await fixture();
  await create();
  await create({ startTime: '14:35', dueDate: '2026-10-30', dueTime: '08:20' });
  const before = service.snapshot();
  assert.deepEqual(
    before.records.map(({ startAt, dueAt }) => [startAt, dueAt]),
    [
      ['2026-10-29T10:00', '2026-10-29T23:59'],
      ['2026-10-29T14:35', '2026-10-30T08:20'],
    ],
  );
  await assert.rejects(create({ dueTime: '09:59' }), /截止时间不能早于开始时间/);
  await assert.rejects(create({ startDate: '2026-10-28' }), /今天或未来/);
  assert.throws(
    () => service.command({ type: 'create', input: input({ startTime: '10:30:15' }) }),
    /时间无效/,
  );
  assert.deepEqual(service.snapshot(), before);
});
test('未来任务可改期和移除，到达开始日期后进入今日清单', async () => {
  const { service, create, nextDay } = await fixture();
  const planned = await create({ startDate: '2026-10-30' });
  const archived = await create({ startDate: '2026-10-31' });
  const initial = service.snapshot().records.find((r) => r.taskId === planned)!;
  assert.equal(initial.startAt, '2026-10-30T00:00');
  assert.equal(initial.dueAt, '2026-10-30T23:59');
  await assert.rejects(
    service.command({ type: 'complete', taskId: planned, completed: true }),
    /不在今日清单中/,
  );
  await service.command({
    type: 'edit',
    taskId: planned,
    input: input({ startDate: '2026-10-31', startTime: '09:15' }),
  });
  await service.command({ type: 'archive', taskId: archived });
  nextDay();
  assert.equal(
    (await service.command({ type: 'refresh' })).records.some((r) => r.date === '2026-10-30'),
    false,
  );
  nextDay(31);
  const active = await service.command({ type: 'complete', taskId: planned, completed: true });
  assert.deepEqual(
    active.records
      .filter((r) => !r.removed)
      .map(({ date, startAt, completed }) => [date, startAt, completed]),
    [['2026-10-31', '2026-10-31T09:15', true]],
  );
});
test('每日任务按日期平移时间，一次性任务顺延时保留原截止时间', async () => {
  const { service, create, nextDay } = await fixture();
  const repeat = await create({
    repeat: true,
    startTime: '22:15',
    dueDate: '2026-10-30',
    dueTime: '08:40',
  });
  const once = await create();
  nextDay();
  const records = (await service.command({ type: 'refresh' })).records;
  const repeated = records.find((r) => r.taskId === repeat && r.date === '2026-10-30')!;
  assert.equal(repeated.startAt, '2026-10-30T22:15');
  assert.equal(repeated.dueAt, '2026-10-31T08:40');
  assert.equal(
    records.find((r) => r.taskId === once && r.date === '2026-10-30')!.dueAt,
    '2026-10-29T23:59',
  );
  assert.equal(
    records.find((r) => r.taskId === repeat && r.date === '2026-10-29')!.startAt,
    '2026-10-29T22:15',
  );
});
test('未完成顺延、完成的一次性任务不顺延、每日任务重置；历史快照固定', async () => {
  const { service, create, nextDay } = await fixture();
  const carried = await create({ title: '未完成' });
  const done = await create({ title: '已完成' });
  const daily = await create({ title: '每日', repeat: true });
  await service.command({ type: 'complete', taskId: done, completed: true });
  await service.command({ type: 'complete', taskId: daily, completed: true });
  const old = service.snapshot().records;
  nextDay();
  await service.command({ type: 'refresh' });
  const records = service.snapshot().records.filter((r) => r.date === '2026-10-30');
  assert.deepEqual(records.map((r) => r.taskId).sort(), [carried, daily].sort());
  assert.equal(
    records.every((r) => !r.completed),
    true,
  );
  assert.deepEqual(
    service.snapshot().records.filter((r) => r.date === '2026-10-29'),
    old,
  );
  await service.command({ type: 'edit', taskId: carried, input: input({ title: '新标题' }) });
  assert.equal(
    service.snapshot().records.find((r) => r.date === '2026-10-29' && r.taskId === carried)!.title,
    '未完成',
  );
});
test('多日未使用只生成当前日期，重复刷新幂等', async () => {
  const { service, create, nextDay } = await fixture();
  await create({ repeat: true });
  nextDay(33);
  await service.command({ type: 'refresh' });
  await service.command({ type: 'refresh' });
  assert.deepEqual(
    service.snapshot().records.map((r) => r.date),
    ['2026-10-29', '2026-11-02'],
  );
});
test('每日计数归零，累计计数延续；达标不会自动完成', async () => {
  const { service, create, nextDay } = await fixture();
  const daily = await create({ kind: 'daily-counter', repeat: true, goal: 5, unit: '条' });
  const cumulative = await create({ kind: 'cumulative-counter', goal: 5, unit: '篇' });
  for (const taskId of [daily, cumulative])
    await service.command({ type: 'counterSet', taskId, value: 7 });
  assert.equal(
    service.snapshot().records.every((r) => !r.completed),
    true,
  );
  await service.command({ type: 'complete', taskId: daily, completed: true });
  await service.command({ type: 'counterDelta', taskId: daily, delta: 1 });
  assert.equal(service.snapshot().records.find((r) => r.taskId === daily)!.completed, true);
  nextDay();
  await service.command({ type: 'refresh' });
  const records = service.snapshot().records.filter((r) => r.date === '2026-10-30');
  assert.equal(records.find((r) => r.taskId === daily)!.value, 0);
  assert.equal(records.find((r) => r.taskId === cumulative)!.value, 7);
  assert.equal(
    records.every((r) => !r.completed),
    true,
  );
});
test('并发加减串行提交不丢计数，直接输入记录差额，零值不变成负数', async () => {
  const { service, create } = await fixture();
  const id = await create({ kind: 'cumulative-counter' });
  await Promise.all(
    Array.from({ length: 40 }, () =>
      service.command({ type: 'counterDelta', taskId: id, delta: 1 }),
    ),
  );
  await Promise.all(
    Array.from({ length: 5 }, () =>
      service.command({ type: 'counterDelta', taskId: id, delta: -1 }),
    ),
  );
  assert.equal(service.snapshot().records[0].value, 35);
  await service.command({ type: 'counterSet', taskId: id, value: 12 });
  assert.equal(service.snapshot().changes.at(-1)!.delta, -23);
  assert.equal(
    service.snapshot().changes.reduce((s, c) => s + c.delta, 0),
    12,
  );
  await service.command({ type: 'counterSet', taskId: id, value: 0 });
  await service.command({ type: 'counterDelta', taskId: id, delta: -1 });
  assert.equal(service.snapshot().records[0].value, 0);
});
test('次日首次操作会先切换日期，模拟午夜或休眠恢复', async () => {
  const { service, create, nextDay } = await fixture();
  const id = await create({ kind: 'daily-counter', repeat: true });
  await service.command({ type: 'counterSet', taskId: id, value: 9 });
  nextDay();
  await service.command({ type: 'counterDelta', taskId: id, delta: 1 });
  assert.deepEqual(
    service.snapshot().records.map((r) => r.value),
    [9, 1],
  );
});
test('空日报、计数净变化、手动编辑与重复生成保护', async () => {
  const { service, create, nextDay } = await fixture();
  await service.command({ type: 'generateSummary', date: '2026-10-29', overwrite: false });
  assert.match(service.snapshot().summaries[0].content, /今日完成（0\/0）/);
  const id = await create({ title: '处理工单', kind: 'cumulative-counter', goal: 20, unit: '条' });
  await service.command({ type: 'counterSet', taskId: id, value: 10 });
  await service.command({ type: 'generateSummary', date: '2026-10-29', overwrite: true });
  assert.match(service.snapshot().summaries[0].content, /净变化 \+10条；累计 10条 \/ 目标 20条/);
  await service.command({ type: 'saveSummary', date: '2026-10-29', content: '我的日报' });
  await assert.rejects(
    service.command({ type: 'generateSummary', date: '2026-10-29', overwrite: false }),
    /已有总结/,
  );
  nextDay();
  await service.command({ type: 'counterSet', taskId: id, value: 7 });
  await service.command({ type: 'generateSummary', date: '2026-10-30', overwrite: false });
  assert.match(service.snapshot().summaries[1].content, /净变化 -3条；累计 7条/);
  assert.equal(service.snapshot().summaries[0].content, '我的日报');
});
test('移除停止重复、保留历史与已保存总结，历史不参与今日写操作', async () => {
  const { service, create, nextDay } = await fixture();
  const id = await create({ repeat: true });
  await service.command({ type: 'generateSummary', date: '2026-10-29', overwrite: false });
  const summary = service.snapshot().summaries[0].content;
  nextDay();
  await service.command({ type: 'archive', taskId: id });
  assert.equal(service.snapshot().records[0].removed, false);
  assert.equal(service.snapshot().records[1].removed, true);
  nextDay(31);
  await service.command({ type: 'refresh' });
  assert.equal(service.snapshot().records.length, 2);
  assert.equal(service.snapshot().summaries[0].content, summary);
  await assert.rejects(
    service.command({ type: 'complete', taskId: id, completed: true }),
    /已移除/,
  );
});
test('写入失败不更新内存、不广播，失败后队列仍可继续', async () => {
  const { service, create, repo } = await fixture();
  const id = await create();
  let broadcasts = 0;
  service.subscribe(() => broadcasts++);
  repo.fail = true;
  await assert.rejects(
    service.command({ type: 'complete', taskId: id, completed: true }),
    /disk unavailable/,
  );
  assert.equal(service.snapshot().records[0].completed, false);
  assert.equal(broadcasts, 0);
  repo.fail = false;
  await service.command({ type: 'complete', taskId: id, completed: true });
  assert.equal(service.snapshot().records[0].completed, true);
  assert.equal(broadcasts, 1);
});
test('主题、置顶与窗口位置保存；读取重启还原', async () => {
  const { service, repo } = await fixture();
  await service.command({ type: 'settings', theme: 'dark', pinned: false });
  await service.updateBounds('float', { x: 10, y: 20, width: 360, height: 550 });
  const reopened = await TodoService.open(repo, () => new Date(2026, 9, 29));
  assert.equal(reopened.snapshot().settings.theme, 'dark');
  assert.equal(reopened.snapshot().settings.pinned, false);
  assert.equal(reopened.snapshot().settings.windows.float!.y, 20);
});
test('输入校验拒绝负数、小数、空标题、矛盾类型与无效日期', () => {
  for (const value of [-1, 1.2, 1e12])
    assert.equal(
      commandSchema.safeParse({ type: 'counterSet', taskId: 'x', value }).success,
      false,
    );
  assert.equal(
    commandSchema.safeParse({ type: 'create', input: input({ title: '  ' }) }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({
      type: 'create',
      input: input({ kind: 'daily-counter', repeat: false }),
    }).success,
    false,
  );
  assert.equal(
    commandSchema.safeParse({ type: 'generateSummary', date: '2026-02-30', overwrite: false })
      .success,
    false,
  );
});
test('真实文件保存、备份与损坏恢复，异常文件被保留', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tododesk-store-'));
  const file = path.join(dir, 'data.json');
  const repo = new JsonRepository(file);
  const service = await TodoService.open(repo, () => new Date(2026, 9, 29));
  await service.command({ type: 'create', input: input({ title: '持久化任务' }) });
  await service.command({ type: 'settings', theme: 'dark' });
  assert.equal(JSON.parse(await readFile(file, 'utf8')).settings.theme, 'dark');
  assert.equal(JSON.parse(await readFile(file + '.bak', 'utf8')).tasks[0].title, '持久化任务');
  await writeFile(file, '{bad json');
  const recoveredRepo = new JsonRepository(file);
  const recovered = await recoveredRepo.load('2026-10-29');
  assert.equal(recovered.tasks[0].title, '持久化任务');
  assert.ok(recoveredRepo.recoveryNotice);
  assert.ok((await readdir(dir)).some((name) => name.includes('.corrupt-')));
});
test('不兼容的数据版本不会被备份覆盖，双损坏不会初始化空数据', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tododesk-version-'));
  const file = path.join(dir, 'data.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 99 }));
  await writeFile(file + '.bak', JSON.stringify(emptyStore('2026-10-29')));
  await assert.rejects(new JsonRepository(file).load('2026-10-29'), /版本/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schemaVersion, 99);
  await writeFile(file, 'bad');
  await writeFile(file + '.bak', 'bad');
  await assert.rejects(new JsonRepository(file).load('2026-10-29'), /均无法校验/);
  assert.equal(await readFile(file, 'utf8'), 'bad');
});
test('真实文件替换失败时原始文件保持不变', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'tododesk-failure-'));
  const file = path.join(dir, 'data.json');
  const repo = new JsonRepository(file);
  const old = await repo.load('2026-10-29');
  await mkdir(file + '.bak');
  const next = structuredClone(old);
  next.settings.theme = 'dark';
  await assert.rejects(repo.save(next), /保存失败/);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).settings.theme, 'light');
});
test('显示器移除与缩放后窗口被限制到工作区内', () => {
  const area = { x: 0, y: 0, width: 1280, height: 720 };
  const result = visibleBounds({ x: 3000, y: 1200, width: 1600, height: 900 }, [area], false);
  assert.deepEqual(result, area);
  const float = visibleBounds({ x: -100, y: -100, width: 360, height: 560 }, [area], true);
  assert.equal(float.x, 0);
  assert.equal(float.y, 0);
  assert.equal(dateKey(new Date(2026, 9, 29, 23, 59)), '2026-10-29');
});
