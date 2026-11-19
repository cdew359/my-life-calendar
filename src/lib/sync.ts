import type { AppData, Habit, HomeCity } from "./types";

/** 实体的有效时间戳：编辑与删除中较新者 */
function effectiveTs(item: { updatedAt: number; deletedAt: number | null }): number {
  return Math.max(item.updatedAt, item.deletedAt ?? 0);
}

/** 按唯一标识合并两组条目，冲突时采用较新的状态。 */
function mergeById<T extends { id: string; updatedAt: number; deletedAt: number | null }>(
  local: T[],
  remote: T[],
): T[] {
  const byId = new Map<string, T>();
  for (const item of [...local, ...remote]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const a = existing;
    const b = item;
    const tsA = effectiveTs(a);
    const tsB = effectiveTs(b);
    if (tsA === tsB) {
      // 时间戳相同取墓碑方（删除优先，保证删除结论稳定）
      byId.set(a.id, a.deletedAt ? a : b);
    } else {
      byId.set(a.id, tsA > tsB ? a : b);
    }
  }
  return Array.from(byId.values());
}

/** 习惯的打卡按并集合并（文本等其余字段仍走最后写入赢） */
function mergeHabit(local: Habit[], remote: Habit[]): Habit[] {
  return mergeById(local, remote).map((habit) => {
    const l = local.find((h) => h.id === habit.id);
    const r = remote.find((h) => h.id === habit.id);
    if (!l || !r) return habit;
    const alive = [l, r].filter((h) => h.deletedAt === null);
    const checkIns = Array.from(new Set(alive.flatMap((h) => h.checkIns))).sort();
    return { ...habit, checkIns };
  });
}

/** 单例城市（常驻/关注）：按 updatedAt 新者胜（无删除语义，一方为空直接取另一方） */
function mergeHomeCity(local: HomeCity | null, remote: HomeCity | null): HomeCity | null {
  if (!local) return remote;
  if (!remote) return local;
  return remote.updatedAt > local.updatedAt ? remote : local;
}

/** 多端合并：同 id 实体最后写入赢，删除墓碑优先于同时刻编辑，打卡取并集 */
export function mergeData(local: AppData, remote: AppData): AppData {
  return {
    version: 2,
    timelines: mergeById(local.timelines ?? [], remote.timelines ?? []),
    plans: mergeById(local.plans, remote.plans),
    notes: mergeById(local.notes, remote.notes),
    habits: mergeHabit(local.habits, remote.habits),
    anniversaries: mergeById(local.anniversaries, remote.anniversaries).map((ann) => {
      // 旧客户端可能清洗掉新字段；保留已知生日规则，同时仍接受名称更新和删除墓碑。
      if (ann.birthday) return ann;
      const birthday = [...local.anniversaries, ...remote.anniversaries].find(
        (a) => a.id === ann.id && a.birthday,
      )?.birthday;
      return birthday ? { ...ann, birthday } : ann;
    }),
    reminders: mergeById(local.reminders, remote.reminders),
    homeCity: mergeHomeCity(local.homeCity, remote.homeCity),
    watchCity: mergeHomeCity(local.watchCity, remote.watchCity),
  };
}

/** 规范化序列化（键排序），用于内容级比较 */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** 比较两份日历数据是否等价，用于避免重复写入和同步。 */
export function dataEquals(a: AppData, b: AppData): boolean {
  return canonical(a) === canonical(b);
}

/** 清理 30 天前的墓碑；服务端保存时执行，客户端加载时同样执行以收敛 */
export function purgeDeleted(data: AppData, now = Date.now()): AppData {
  /** 保留尚未超过墓碑保留期的条目，防止旧设备复活已删除数据。 */
  const keep = <T extends { deletedAt: number | null }>(items: T[]) =>
    items.filter((item) => item.deletedAt === null || now - item.deletedAt < 30 * 86_400_000);
  return {
    version: 2,
    timelines: keep(data.timelines ?? []),
    plans: keep(data.plans),
    notes: keep(data.notes),
    habits: keep(data.habits),
    anniversaries: keep(data.anniversaries),
    reminders: keep(data.reminders),
    homeCity: data.homeCity,
    watchCity: data.watchCity,
  };
}
