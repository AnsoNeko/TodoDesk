import * as fs from 'node:fs/promises';
import path from 'node:path';
import { storeSchema, emptyStore, type Store } from '../shared/model';

export interface Repository {
  file: string;
  recoveryNotice?: string;
  load(date: string): Promise<Store>;
  save(store: Store): Promise<void>;
}
export class JsonRepository implements Repository {
  recoveryNotice?: string;
  constructor(public file: string) {}
  private decode(raw: string): Store {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1)
      throw new Error('UNSUPPORTED_VERSION');
    return storeSchema.parse(value);
  }
  async load(date: string): Promise<Store> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    let originalError: unknown;
    try {
      return this.decode(await fs.readFile(this.file, 'utf8'));
    } catch (error) {
      originalError = error;
    }
    if (originalError instanceof Error && originalError.message === 'UNSUPPORTED_VERSION')
      throw new Error('数据版本与当前应用不兼容。请使用较新版本打开，原始数据未被修改。');
    let backup: string;
    try {
      backup = await fs.readFile(`${this.file}.bak`, 'utf8');
    } catch (error) {
      if (
        (originalError as NodeJS.ErrnoException).code === 'ENOENT' &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        const initial = emptyStore(date);
        await this.save(initial);
        return initial;
      }
      throw new Error(`无法读取本地数据或备份，未清空任何数据。请保留并检查：${this.file}`);
    }
    let restored: Store;
    try {
      restored = this.decode(backup);
    } catch {
      throw new Error(`本地数据与备份均无法校验，未清空任何数据。请保留并检查：${this.file}`);
    }
    if ((originalError as NodeJS.ErrnoException).code !== 'ENOENT')
      await fs.copyFile(this.file, `${this.file}.corrupt-${Date.now()}`);
    const temp = `${this.file}.recover`;
    await fs.writeFile(temp, backup, 'utf8');
    await fs.rename(temp, this.file);
    this.recoveryNotice =
      '检测到数据文件异常，已从上一份有效备份恢复。异常文件已保留在数据目录中。';
    return restored;
  }
  async save(store: Store) {
    storeSchema.parse(store);
    const temp = `${this.file}.tmp`;
    try {
      const handle = await fs.open(temp, 'w');
      try {
        await handle.writeFile(JSON.stringify(store, null, 2), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await fs.copyFile(this.file, `${this.file}.bak`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await fs.rename(temp, this.file);
    } catch (error) {
      await fs.unlink(temp).catch(() => {});
      throw new Error(
        `保存失败，本次操作未提交。请检查磁盘空间及目录权限。${error instanceof Error ? ` (${error.message})` : ''}`,
      );
    }
  }
}
