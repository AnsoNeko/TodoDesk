import { z } from 'zod';

export const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T12:00:00`);
    return !Number.isNaN(d.getTime()) && dateKey(d) === v;
  }, '日期无效');
const count = z.number().int().min(0).max(999999999);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, '时间无效');
const dateTime = z
  .string()
  .refine(
    (v) =>
      v.length === 16 &&
      v[10] === 'T' &&
      day.safeParse(v.slice(0, 10)).success &&
      time.safeParse(v.slice(11)).success,
    '日期或时间无效',
  );
export const taskInputSchema = z
  .object({
    title: z.string().trim().min(1, '请输入任务标题').max(120),
    note: z.string().max(2000).default(''),
    kind: z.enum(['task', 'daily-counter', 'cumulative-counter']),
    repeat: z.boolean(),
    goal: count.refine((v) => v > 0).nullable(),
    unit: z.string().trim().max(12),
    startDate: day.optional(),
    startTime: time.optional(),
    dueDate: day.optional(),
    dueTime: time.optional(),
  })
  .strict()
  .refine(
    (v) => v.kind !== 'task' || (v.goal === null && v.unit === ''),
    '普通任务不能设置计数目标',
  )
  .refine((v) => v.kind !== 'daily-counter' || v.repeat, '每日计数必须每日重复')
  .refine((v) => v.kind !== 'cumulative-counter' || !v.repeat, '累计计数不支持每日重复');
export type TaskInput = z.infer<typeof taskInputSchema>;

const fields = {
  title: z.string().min(1).max(120),
  note: z.string().max(2000),
  kind: z.enum(['task', 'daily-counter', 'cumulative-counter']),
  repeat: z.boolean(),
  goal: count.refine((v) => v > 0).nullable(),
  unit: z.string().max(12),
  startAt: dateTime.optional(),
  dueAt: dateTime.optional(),
};
const taskSchema = z.object({
  ...fields,
  id: z.string(),
  createdAt: z.string(),
  archivedAt: z.string().nullable(),
  completed: z.boolean(),
  value: count,
});
const recordSchema = z.object({
  ...fields,
  id: z.string(),
  taskId: z.string(),
  date: day,
  createdAt: z.string(),
  completed: z.boolean(),
  completedAt: z.string().nullable(),
  value: count,
  removed: z.boolean(),
});
const bounds = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(100).max(20000),
  height: z.number().int().min(100).max(20000),
});
export const settingsSchema = z.object({
  theme: z.enum(['light', 'dark']),
  pinned: z.boolean(),
  windows: z.object({ main: bounds.optional(), float: bounds.optional() }),
});
export const storeSchema = z
  .object({
    schemaVersion: z.literal(1),
    activeDate: day,
    tasks: z.array(taskSchema),
    records: z.array(recordSchema),
    changes: z.array(
      z.object({
        id: z.string(),
        taskId: z.string(),
        recordId: z.string(),
        date: day,
        delta: z.number().int(),
        value: count,
        at: z.string(),
      }),
    ),
    summaries: z.array(
      z.object({
        date: day,
        content: z.string().max(200000),
        generatedAt: z.string(),
        updatedAt: z.string(),
      }),
    ),
    settings: settingsSchema,
  })
  .superRefine((s, ctx) => {
    const ids = new Set(s.tasks.map((t) => t.id));
    const recordIds = new Set(s.records.map((r) => r.id));
    if (
      ids.size !== s.tasks.length ||
      recordIds.size !== s.records.length ||
      new Set(s.records.map((r) => `${r.taskId}:${r.date}`)).size !== s.records.length ||
      new Set(s.summaries.map((v) => v.date)).size !== s.summaries.length ||
      s.records.some((r) => !ids.has(r.taskId)) ||
      s.changes.some((c) => !ids.has(c.taskId) || !recordIds.has(c.recordId))
    ) {
      ctx.addIssue({ code: 'custom', message: '数据关联或唯一性校验失败' });
    }
  });
export type Store = z.infer<typeof storeSchema>;
export type TaskRecord = Store['records'][number];
export type Settings = Store['settings'];
export type Bounds = z.infer<typeof bounds>;
export type Snapshot = Store & { today: string; storagePath: string; recoveryNotice?: string };
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('refresh') }).strict(),
  z.object({ type: z.literal('create'), input: taskInputSchema }).strict(),
  z.object({ type: z.literal('edit'), taskId: z.string(), input: taskInputSchema }).strict(),
  z.object({ type: z.literal('archive'), taskId: z.string() }).strict(),
  z.object({ type: z.literal('complete'), taskId: z.string(), completed: z.boolean() }).strict(),
  z
    .object({
      type: z.literal('counterDelta'),
      taskId: z.string(),
      delta: z.union([z.literal(1), z.literal(-1)]),
    })
    .strict(),
  z.object({ type: z.literal('counterSet'), taskId: z.string(), value: count }).strict(),
  z.object({ type: z.literal('generateSummary'), date: day, overwrite: z.boolean() }).strict(),
  z.object({ type: z.literal('saveSummary'), date: day, content: z.string().max(200000) }).strict(),
  z
    .object({
      type: z.literal('settings'),
      theme: z.enum(['light', 'dark']).optional(),
      pinned: z.boolean().optional(),
    })
    .strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export type WindowAction = 'main' | 'float' | 'hide' | 'minimize' | 'quit' | 'openDataFolder';
export type UpdateAction = 'status' | 'check' | 'download' | 'install' | 'releases';
export type UpdateState = {
  currentVersion: string;
  status:
    | 'unavailable'
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'error';
  version?: string;
  progress?: number;
  message?: string;
};
export interface TodoAPI {
  command(command: Command): Promise<Snapshot>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
  window(action: WindowAction): Promise<void>;
  copy(text: string): Promise<void>;
  update(action: UpdateAction): Promise<UpdateState>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
}
export function emptyStore(date: string): Store {
  return {
    schemaVersion: 1,
    activeDate: date,
    tasks: [],
    records: [],
    changes: [],
    summaries: [],
    settings: { theme: 'light', pinned: true, windows: {} },
  };
}
