import fs from "node:fs";
import path from "node:path";
import { coerceData, emptyData } from "../../src/lib/validate.ts";
import { purgeDeleted } from "../../src/lib/sync.ts";
import type { AppData } from "../../src/lib/types.ts";

export interface StoredState {
  version: number;
  data: AppData;
}

/**
 * 单账号数据文件：data-<accountId>.json 落盘（临时文件 + 原子重命名）。
 * API 在写入前合并最新数据；此存储层负责原子落盘。
 * 保存时顺带清理 30 天前的删除墓碑，避免数据只增不减。
 */
export class Store {
  private file: string;

  /** 为指定账号确定独立的日历数据文件路径。 */
  constructor(dataDir: string, accountId: string) {
    this.file = path.join(dataDir, `data-${accountId}.json`);
  }

  /** 首个账号注册时继承旧版单用户数据（data.json），保持升级不丢数据 */
  static adoptLegacy(dataDir: string, accountId: string) {
    const legacy = path.join(dataDir, "data.json");
    const target = path.join(dataDir, `data-${accountId}.json`);
    try {
      if (fs.existsSync(legacy) && !fs.existsSync(target)) {
        fs.renameSync(legacy, target);
      }
    } catch {
      // 迁移失败不阻断注册，按空库启动
    }
  }

  /** 读取并清洗账号快照，文件缺失或损坏时返回空日历及初始版本。 */
  load(): StoredState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, "utf8"));
      if (raw && typeof raw === "object" && typeof raw.version === "number") {
        return { version: raw.version, data: coerceData(raw.data) };
      }
    } catch {
      // 文件不存在或损坏 → 空库启动
    }
    return { version: 0, data: emptyData() };
  }

  /** 清洗快照并清理过期墓碑，更新版本后通过临时文件原子保存。 */
  save(incoming: unknown): StoredState {
    const data = purgeDeleted(coerceData(incoming));
    const version = Date.now();
    const state: StoredState = { version, data };
    const tmp = `${this.file}.tmp`;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, this.file);
    return state;
  }
}
