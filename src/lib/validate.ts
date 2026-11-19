import { coerceTimelines } from "./timelines";
import { coerceBirthday } from "./birthdayRules";
import type {
  AppData,
  Anniversary,
  CityRecord,
  DayNote,
  Domain,
  Habit,
  Plan,
  Reminder,
} from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 格式 + 真实日历日期双重校验（拒绝 2099-13-45、2026-02-30 之类） */
export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 创建包含各类空列表的初始日历数据。 */
export function emptyData(): AppData {
  return {
    version: 2,
    timelines: [],
    plans: [],
    notes: [],
    habits: [],
    anniversaries: [],
    reminders: [],
    homeCity: null,
    watchCity: null,
  };
}

/** 城市字段清洗：名字非空 + 坐标为有限数字才有效 */
export function coerceCity(value: unknown): CityRecord | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  const lat = Number(v.lat);
  const lon = Number(v.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { name: v.name.trim().slice(0, 24), lat, lon };
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

let seq = 0;
/** 生成新条目的唯一标识。 */
export function newId() {
  seq += 1;
  return `${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── 数据校验与迁移（纯函数，前端与同步服务端共用） ───────

/** 将分类值规范为工作或生活，未知值按生活处理。 */
function coerceDomain(value: unknown): Domain {
  return value === "work" ? "work" : "life";
}

/** 同步元数据：updatedAt 缺省回退 createdAt，deletedAt 缺省 null（旧数据自动补齐） */
function coerceMeta(row: Record<string, unknown>, createdAt: number) {
  return {
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : createdAt,
    deletedAt: typeof row.deletedAt === "number" ? row.deletedAt : null,
  };
}

/** 绑定账号列表：字符串数组，去重去空，最多 8 个 */
function coerceShareWith(row: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(row.shareWith)) return undefined;
  const list = Array.from(
    new Set(
      (row.shareWith as unknown[])
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .map((s) => s.trim().slice(0, 24)),
    ),
  ).slice(0, 8);
  return list.length > 0 ? list : undefined;
}

/** 清洗分享来源账号，空值或非法值不作为分享标记。 */
function coerceSharedBy(row: Record<string, unknown>): string | undefined {
  return typeof row.sharedBy === "string" && row.sharedBy.trim()
    ? row.sharedBy.trim().slice(0, 24)
    : undefined;
}

/** 将旧版计划列表迁移成当前日历数据结构。 */
export function coerceLegacyPlans(raw: unknown): Plan[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === "object" && typeof (p as Plan).id === "string",
    )
    .filter((p) => isValidDateKey(p.date))
    .filter((p) => typeof p.text === "string" && (p.text as string).trim().length > 0)
    .map((p) => {
      const createdAt = typeof p.createdAt === "number" ? (p.createdAt as number) : Date.now();
      return {
        id: p.id as string,
        date: p.date as string,
        text: (p.text as string).trim(),
        done: p.done === true,
        doneAt: typeof p.doneAt === "number" ? (p.doneAt as number) : null,
        createdAt,
        domain: coerceDomain((p as Record<string, unknown>).domain),
        shareWith: coerceShareWith(p as Record<string, unknown>),
        sharedBy: coerceSharedBy(p as Record<string, unknown>),
        ...coerceMeta(p, createdAt),
      };
    });
}

/** 清洗各类日历条目并补齐默认字段，兼容旧客户端数据。 */
export function coerceData(raw: unknown): AppData {
  if (!raw || typeof raw !== "object") return emptyData();
  const r = raw as Record<string, unknown>;
  const data = emptyData();
  data.plans = coerceLegacyPlans(r.plans);
  if (Array.isArray(r.notes)) {
    data.notes = r.notes
      .filter((n) => !!n && typeof n === "object")
      .filter((n) => isValidDateKey((n as unknown as Record<string, unknown>).date))
      .filter(
        (n) => typeof (n as DayNote).text === "string" && (n as DayNote).text.trim().length > 0,
      )
      .map((n) => {
        const note = n as Record<string, unknown>;
        const createdAt = typeof note.createdAt === "number" ? note.createdAt : Date.now();
        return {
          id: typeof note.id === "string" ? note.id : newId(),
          date: note.date as string,
          text: (note.text as string).trim(),
          createdAt,
          domain: coerceDomain(note.domain),
          shareWith: coerceShareWith(note),
          sharedBy: coerceSharedBy(note),
          ...coerceMeta(note, createdAt),
        } satisfies DayNote;
      });
  }
  if (Array.isArray(r.habits)) {
    data.habits = r.habits
      .filter((h) => !!h && typeof h === "object" && typeof (h as Habit).text === "string")
      .map((h) => {
        const habit = h as Record<string, unknown>;
        const createdAt = typeof habit.createdAt === "number" ? habit.createdAt : Date.now();
        return {
          id: typeof habit.id === "string" ? habit.id : newId(),
          text: (habit.text as string).trim(),
          domain: coerceDomain(habit.domain),
          createdAt,
          archivedAt: typeof habit.archivedAt === "number" ? habit.archivedAt : null,
          checkIns: Array.isArray(habit.checkIns)
            ? (habit.checkIns as unknown[]).filter((d) => isValidDateKey(d)).sort()
            : [],
          ...coerceMeta(habit, createdAt),
        } satisfies Habit;
      });
  }
  if (Array.isArray(r.anniversaries)) {
    data.anniversaries = r.anniversaries
      .filter((a) => !!a && typeof a === "object" && typeof (a as Anniversary).name === "string")
      .filter((a) => isValidDateKey((a as unknown as Record<string, unknown>).date))
      .map((a) => {
        const ann = a as Record<string, unknown>;
        const createdAt = typeof ann.createdAt === "number" ? ann.createdAt : Date.now();
        return {
          id: typeof ann.id === "string" ? ann.id : newId(),
          name: (ann.name as string).trim(),
          kind: ann.kind === "once" ? "once" : "yearly",
          date: ann.date as string,
          ...(coerceBirthday(ann.birthday) ? { birthday: coerceBirthday(ann.birthday) } : {}),
          createdAt,
          ...coerceMeta(ann, createdAt),
        } satisfies Anniversary;
      });
  }
  if (Array.isArray(r.reminders)) {
    data.reminders = r.reminders
      .filter((x) => !!x && typeof x === "object" && typeof (x as Reminder).text === "string")
      .filter((x) => TIME_RE.test(String((x as Reminder).time)))
      .map((x) => {
        const row = x as Record<string, unknown>;
        const createdAt = typeof row.createdAt === "number" ? row.createdAt : Date.now();
        const mode = row.mode === "periodic" ? "periodic" : "weekly";
        const weekdays = Array.isArray(row.weekdays)
          ? Array.from(
              new Set(
                (row.weekdays as unknown[])
                  .map((d) => Number(d))
                  .filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
              ),
            ).sort((a, b) => a - b)
          : [1, 2, 3, 4, 5];
        const periodDaysRaw = Number(row.periodDays);
        const anchor = isValidDateKey(row.anchorDate) ? row.anchorDate : "2026-01-01";
        return {
          id: typeof row.id === "string" ? row.id : newId(),
          text: (row.text as string).trim(),
          time: row.time as string,
          mode,
          weekdays: mode === "weekly" && weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5],
          periodDays: Number.isInteger(periodDaysRaw) && periodDaysRaw >= 1 ? periodDaysRaw : 1,
          anchorDate: anchor,
          enabled: row.enabled !== false,
          createdAt,
          ...coerceMeta(row, createdAt),
        } satisfies Reminder;
      });
  }
  /** 借用完整数据清洗规则，校验并规范单个指定类型的条目。 */
  const coerceSingle = (value: unknown): AppData["homeCity"] => {
    const city = coerceCity((value as Record<string, unknown> | undefined)?.city);
    if (!city) return null;
    const row = (value ?? {}) as Record<string, unknown>;
    return { city, updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : 0 };
  };
  data.timelines = coerceTimelines(r.timelines, data.plans);
  data.homeCity = coerceSingle(r.homeCity);
  data.watchCity = coerceSingle(r.watchCity);
  return data;
}
