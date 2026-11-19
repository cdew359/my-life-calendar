import { applyAiPlans, type AiPlanBatch } from "./aiPlans";
import { browserStorage as localStorage } from "./browserStorage";
import { changeTimeline, type TimelineChange } from "./timelines";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AppData,
  CityRecord,
  DayNote,
  Domain,
  Habit,
  Plan,
  Anniversary,
  Reminder,
  Birthday,
} from "./types";
import { coerceData, coerceLegacyPlans, emptyData, isValidDateKey, newId } from "./validate";
import { legacyLocation } from "./weather";

export type { AppData, DayNote, Domain, Habit, Plan, Anniversary, Reminder };
// 校验与迁移的纯函数实现在 validate.ts（与同步服务端共用），这里保留导出兼容既有引用
export { coerceData, coerceLegacyPlans, emptyData, isValidDateKey, newId };

const STORAGE_KEY = "calendar.data.v2";
const LEGACY_KEY = "calendar.plans.v1";
/** 首个登录账号认领无主本地数据的标记，防止第二个账号再认领一遍 */
const CLAIM_KEY = "calendar.data.claimed";

/** 账号分库：登录后每个账号使用独立存储键，互不渗透 */
let activeKey = STORAGE_KEY;

/** 为指定账号生成独立的浏览器存储键。 */
function accountKey(username: string): string {
  return `${STORAGE_KEY}@${username}`;
}

// ── 后端接口：网页 localStorage / 桌面 IPC ───────────────

export interface DataBackend {
  /** 校验并原子保存当前账号确认的 AI 计划批次。 */
  addAiPlans(input: AiPlanBatch): Promise<AppData>;
  /** 应用时间线修改，同时校验版本并重算相关排程。 */
  changeTimeline(input: TimelineChange): Promise<AppData>;
  /** 加载当前账号的完整日历数据。 */
  load(): Promise<AppData>;
  /** 新增指定日期的计划。 */
  addPlan(input: { date: string; text: string; domain: Domain }): Promise<AppData>;
  /** 切换计划的完成状态。 */
  togglePlan(id: string): Promise<AppData>;
  /** 删除指定计划，保留同步所需的删除标记。 */
  removePlan(id: string): Promise<AppData>;
  /** 新增指定日期的每日记录。 */
  addNote(input: { date: string; text: string; domain: Domain }): Promise<AppData>;
  /** 删除每日记录，保留同步所需的删除标记。 */
  removeNote(id: string): Promise<AppData>;
  /** 新增需要持续打卡的习惯。 */
  addHabit(input: { text: string; domain: Domain }): Promise<AppData>;
  /** 切换指定习惯在某一天的打卡状态。 */
  toggleHabitCheckIn(input: { id: string; date: string }): Promise<AppData>;
  /** 移除指定习惯。 */
  removeHabit(id: string): Promise<AppData>;
  /** 新增纪念日，并保留单次或每年重复的类型。 */
  addAnniversary(input: {
    name: string;
    kind: "yearly" | "once";
    date: string;
    birthday?: Birthday;
  }): Promise<AppData>;
  /** 移除指定纪念日。 */
  removeAnniversary(id: string): Promise<AppData>;
  /** 新增提醒规则。 */
  addReminder(
    input: Omit<Reminder, "id" | "createdAt" | "updatedAt" | "deletedAt">,
  ): Promise<AppData>;
  /** 启用或停用指定提醒。 */
  setReminderEnabled(id: string, enabled: boolean): Promise<AppData>;
  /** 移除指定提醒。 */
  removeReminder(id: string): Promise<AppData>;
  /** 设置天气卡片使用的常住城市。 */
  setHomeCity(city: CityRecord): Promise<AppData>;
  /** 设置关注城市；传入空值时取消关注。 */
  setWatchCity(city: CityRecord | null): Promise<AppData>;
  /** 更新计划的分享对象列表。 */
  setPlanShare(id: string, usernames: string[]): Promise<AppData>;
  /** 更新每日记录的分享对象列表。 */
  setNoteShare(id: string, usernames: string[]): Promise<AppData>;
  /** 切换当前账号的本地数据库（null = 无主的本地库）；返回该库数据 */
  setAccount(username: string | null): Promise<AppData>;
  /** 用完整数据快照替换当前账号的本地数据。 */
  replaceAll(data: AppData): Promise<AppData>;
  /** 订阅日历数据变化，并返回取消订阅的方法。 */
  subscribe(cb: (data: AppData) => void): () => void;
}

/** 读取并清洗本地日历数据，必要时迁移未登录状态下的旧版计划。 */
function readLocal(): AppData {
  try {
    const raw = localStorage.getItem(activeKey);
    if (raw) return coerceData(JSON.parse(raw));
    // v1 旧数据只归无主库（未登录时的本地数据）
    if (activeKey === STORAGE_KEY) {
      const legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const migrated = coerceData({ plans: JSON.parse(legacy) });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
        return migrated;
      }
    }
  } catch {
    // 解析失败按空数据启动，不阻塞使用
  }
  return emptyData();
}

/** 保存当前账号的日历快照；存储不可用时保留页面的内存状态。 */
function writeLocal(data: AppData) {
  try {
    localStorage.setItem(activeKey, JSON.stringify(data));
  } catch {
    // 隐私模式/存储满时静默降级为内存态
  }
}

const webBackend: DataBackend = {
  /** 一次校验和落盘整批计划，存储失败向界面报告。 */
  async addAiPlans(input) {
    if (activeKey !== accountKey(input.account)) throw new Error("账号已切换，请重新打开 AI 助手");
    const next = applyAiPlans(readLocal(), input, input.account);
    localStorage.setItem(activeKey, JSON.stringify(next));
    return next;
  },
  /** 应用时间线修改，同时校验版本并重算相关排程。 */
  async changeTimeline(input) {
    const data = changeTimeline(readLocal(), input);
    localStorage.setItem(activeKey, JSON.stringify(data));
    return data;
  },
  /** 加载当前账号的完整日历数据。 */
  async load() {
    return readLocal();
  },
  /** 新增指定日期的计划。 */
  async addPlan({ date, text, domain }) {
    const data = readLocal();
    const now = Date.now();
    data.plans = [
      ...data.plans,
      {
        id: newId(),
        date,
        text: text.trim(),
        done: false,
        doneAt: null,
        createdAt: now,
        domain,
        updatedAt: now,
        deletedAt: null,
      },
    ];
    writeLocal(data);
    return data;
  },
  /** 切换计划的完成状态。 */
  async togglePlan(id) {
    const data = readLocal();
    data.plans = data.plans.map((p) =>
      p.id === id
        ? { ...p, done: !p.done, doneAt: !p.done ? Date.now() : null, updatedAt: Date.now() }
        : p,
    );
    writeLocal(data);
    return data;
  },
  /** 删除指定计划，保留同步所需的删除标记。 */
  async removePlan(id) {
    const data = readLocal();
    data.plans = data.plans.map((p) =>
      p.id === id ? { ...p, deletedAt: Date.now(), updatedAt: Date.now() } : p,
    );
    writeLocal(data);
    return data;
  },
  /** 新增指定日期的每日记录。 */
  async addNote({ date, text, domain }) {
    const data = readLocal();
    const now = Date.now();
    data.notes = [
      ...data.notes,
      {
        id: newId(),
        date,
        text: text.trim(),
        createdAt: now,
        domain,
        updatedAt: now,
        deletedAt: null,
      },
    ];
    writeLocal(data);
    return data;
  },
  /** 删除每日记录，保留同步所需的删除标记。 */
  async removeNote(id) {
    const data = readLocal();
    data.notes = data.notes.map((n) =>
      n.id === id ? { ...n, deletedAt: Date.now(), updatedAt: Date.now() } : n,
    );
    writeLocal(data);
    return data;
  },
  /** 新增需要持续打卡的习惯。 */
  async addHabit({ text, domain }) {
    const data = readLocal();
    const now = Date.now();
    data.habits = [
      ...data.habits,
      {
        id: newId(),
        text: text.trim(),
        domain,
        createdAt: now,
        archivedAt: null,
        checkIns: [],
        updatedAt: now,
        deletedAt: null,
      },
    ];
    writeLocal(data);
    return data;
  },
  /** 切换指定习惯在某一天的打卡状态。 */
  async toggleHabitCheckIn({ id, date }) {
    const data = readLocal();
    data.habits = data.habits.map((h) => {
      if (h.id !== id) return h;
      const checkIns = h.checkIns.includes(date)
        ? h.checkIns.filter((d) => d !== date)
        : [...h.checkIns, date].sort();
      return { ...h, checkIns, updatedAt: Date.now() };
    });
    writeLocal(data);
    return data;
  },
  /** 移除指定习惯。 */
  async removeHabit(id) {
    const data = readLocal();
    data.habits = data.habits.map((h) =>
      h.id === id ? { ...h, deletedAt: Date.now(), updatedAt: Date.now() } : h,
    );
    writeLocal(data);
    return data;
  },
  /** 新增纪念日，并保留单次或每年重复的类型。 */
  async addAnniversary({ name, kind, date, birthday }) {
    const data = readLocal();
    const now = Date.now();
    data.anniversaries = [
      ...data.anniversaries,
      {
        id: newId(),
        name: name.trim(),
        kind,
        date,
        ...(birthday ? { birthday } : {}),
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ];
    writeLocal(data);
    return data;
  },
  /** 移除指定纪念日。 */
  async removeAnniversary(id) {
    const data = readLocal();
    data.anniversaries = data.anniversaries.map((a) =>
      a.id === id ? { ...a, deletedAt: Date.now(), updatedAt: Date.now() } : a,
    );
    writeLocal(data);
    return data;
  },
  /** 新增提醒规则。 */
  async addReminder(input) {
    const data = readLocal();
    const now = Date.now();
    data.reminders = [
      ...data.reminders,
      { ...input, id: newId(), createdAt: now, updatedAt: now, deletedAt: null },
    ];
    writeLocal(data);
    return data;
  },
  /** 启用或停用指定提醒。 */
  async setReminderEnabled(id, enabled) {
    const data = readLocal();
    data.reminders = data.reminders.map((r) =>
      r.id === id ? { ...r, enabled, updatedAt: Date.now() } : r,
    );
    writeLocal(data);
    return data;
  },
  /** 移除指定提醒。 */
  async removeReminder(id) {
    const data = readLocal();
    data.reminders = data.reminders.map((r) =>
      r.id === id ? { ...r, deletedAt: Date.now(), updatedAt: Date.now() } : r,
    );
    writeLocal(data);
    return data;
  },
  /** 设置天气卡片使用的常住城市。 */
  async setHomeCity(city) {
    const data = readLocal();
    data.homeCity = { city, updatedAt: Date.now() };
    writeLocal(data);
    return data;
  },
  /** 设置关注城市；传入空值时取消关注。 */
  async setWatchCity(city) {
    const data = readLocal();
    data.watchCity = city ? { city, updatedAt: Date.now() } : null;
    writeLocal(data);
    return data;
  },
  /** 更新计划的分享对象列表。 */
  async setPlanShare(id, usernames) {
    const data = readLocal();
    data.plans = data.plans.map((p) =>
      p.id === id
        ? {
            ...p,
            shareWith: usernames.length > 0 ? Array.from(new Set(usernames)) : undefined,
            updatedAt: Date.now(),
          }
        : p,
    );
    writeLocal(data);
    return data;
  },
  /** 更新每日记录的分享对象列表。 */
  async setNoteShare(id, usernames) {
    const data = readLocal();
    data.notes = data.notes.map((n) =>
      n.id === id
        ? {
            ...n,
            shareWith: usernames.length > 0 ? Array.from(new Set(usernames)) : undefined,
            updatedAt: Date.now(),
          }
        : n,
    );
    writeLocal(data);
    return data;
  },
  /** 切换当前账号的数据存储，空账号对应未登录时的本地数据。 */
  async setAccount(username) {
    if (!username) {
      activeKey = STORAGE_KEY;
      return readLocal();
    }
    const key = accountKey(username);
    if (!localStorage.getItem(key)) {
      // 账号库首次落本机：无主数据只允许被首个账号认领一次
      const claimed = localStorage.getItem(CLAIM_KEY);
      if (!claimed) {
        const legacy = localStorage.getItem(STORAGE_KEY);
        if (legacy) {
          localStorage.setItem(key, legacy);
          localStorage.setItem(CLAIM_KEY, username);
          // 无主库清空，避免后续账号误认领
          localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyData()));
        }
      }
    }
    activeKey = key;
    return readLocal();
  },
  /** 用完整数据快照替换当前账号的本地数据。 */
  async replaceAll(next) {
    const data = coerceData(next);
    writeLocal(data);
    return data;
  },
  /** 网页端由 React 操作回写状态，无需额外订阅；返回空的取消方法以保持接口一致。 */
  subscribe() {
    return () => {};
  },
};

/** 将统一的数据操作接口适配到 Electron 主进程的 IPC 接口。 */
function desktopBackend(api: NonNullable<typeof window.desktopAPI>): DataBackend {
  const d = api.data;
  return {
    /** 使用受限 IPC 保存整批计划；旧客户端提示升级。 */
    addAiPlans: (input) => {
      if (!d.addAiPlans) return Promise.reject(new Error("请更新客户端后使用 AI 批量保存"));
      return d.addAiPlans(input);
    },
    /** 应用时间线修改，同时校验版本并重算相关排程。 */
    changeTimeline: (input) => d.changeTimeline(input),
    /** 加载当前账号的完整日历数据。 */
    load: () => d.load(),
    /** 新增指定日期的计划。 */
    addPlan: (input) => d.addPlan(input),
    /** 切换计划的完成状态。 */
    togglePlan: (id) => d.togglePlan(id),
    /** 删除指定计划，保留同步所需的删除标记。 */
    removePlan: (id) => d.removePlan(id),
    /** 新增指定日期的每日记录。 */
    addNote: (input) => d.addNote(input),
    /** 删除每日记录，保留同步所需的删除标记。 */
    removeNote: (id) => d.removeNote(id),
    /** 新增需要持续打卡的习惯。 */
    addHabit: (input) => d.addHabit(input),
    /** 切换指定习惯在某一天的打卡状态。 */
    toggleHabitCheckIn: (input) => d.toggleHabitCheckIn(input),
    /** 移除指定习惯。 */
    removeHabit: (id) => d.removeHabit(id),
    /** 新增纪念日，并保留单次或每年重复的类型。 */
    addAnniversary: (input) => d.addAnniversary(input),
    /** 移除指定纪念日。 */
    removeAnniversary: (id) => d.removeAnniversary(id),
    /** 新增提醒规则。 */
    addReminder: (input) => d.addReminder(input),
    /** 启用或停用指定提醒。 */
    setReminderEnabled: (id, enabled) => d.setReminderEnabled(id, enabled),
    /** 移除指定提醒。 */
    removeReminder: (id) => d.removeReminder(id),
    /** 设置天气卡片使用的常住城市。 */
    setHomeCity: (city) => d.setHomeCity(city),
    /** 设置关注城市；传入空值时取消关注。 */
    setWatchCity: (city) => d.setWatchCity(city),
    /** 更新计划的分享对象列表。 */
    setPlanShare: (id, usernames) => d.setPlanShare(id, usernames),
    /** 更新每日记录的分享对象列表。 */
    setNoteShare: (id, usernames) => d.setNoteShare(id, usernames),
    /** 切换当前账号的数据存储，空账号对应未登录时的本地数据。 */
    setAccount: (username) => d.setAccount(username),
    /** 用完整数据快照替换当前账号的本地数据。 */
    replaceAll: (data) => d.replaceAll(data),
    /** 订阅日历数据变化，并返回取消订阅的方法。 */
    subscribe(cb) {
      return d.subscribe(cb);
    },
  };
}

const backend: DataBackend =
  typeof window !== "undefined" && window.desktopAPI
    ? desktopBackend(window.desktopAPI)
    : webBackend;

// ── React Hook ──────────────────────────────────────────

/** 选择网页或桌面数据后端，管理日历状态和各类修改操作。 */
export function useData() {
  const [data, setData] = useState<AppData>(emptyData);
  const accountEpoch = useRef(0);

  useEffect(() => {
    let alive = true;
    backend
      .load()
      .then(async (d) => {
        if (!alive) return;
        // 首次进入地区系统：把旧版手选的天气城市迁移为常驻地区（桌面端在主进程已迁移）
        if (d.homeCity === null) {
          const loc = legacyLocation();
          if (loc) {
            const next = await backend.setHomeCity(loc).catch(() => null);
            if (alive && next) {
              setData(next);
              return;
            }
          }
        }
        setData(d);
      })
      .catch(() => {});
    const off = backend.subscribe((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  /** 执行数据后端操作，并用返回的快照刷新 React 状态。 */
  const run = useCallback((fn: () => Promise<AppData>) => {
    fn()
      .then(setData)
      .catch(() => {});
  }, []);

  /** 新增指定日期的计划。 */
  const addPlan = useCallback(
    (date: string, text: string, domain: Domain) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      run(() => backend.addPlan({ date, text: trimmed, domain }));
    },
    [run],
  );

  /** 切换计划的完成状态。 */
  const togglePlan = useCallback((id: string) => run(() => backend.togglePlan(id)), [run]);
  /** 删除指定计划，保留同步所需的删除标记。 */
  const removePlan = useCallback((id: string) => run(() => backend.removePlan(id)), [run]);

  /** 新增指定日期的每日记录。 */
  const addNote = useCallback(
    (date: string, text: string, domain: Domain) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      run(() => backend.addNote({ date, text: trimmed, domain }));
    },
    [run],
  );
  /** 删除每日记录，保留同步所需的删除标记。 */
  const removeNote = useCallback((id: string) => run(() => backend.removeNote(id)), [run]);

  /** 新增需要持续打卡的习惯。 */
  const addHabit = useCallback(
    (text: string, domain: Domain) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      run(() => backend.addHabit({ text: trimmed, domain }));
    },
    [run],
  );
  /** 切换指定习惯在某一天的打卡状态。 */
  const toggleHabitCheckIn = useCallback(
    (id: string, date: string) => run(() => backend.toggleHabitCheckIn({ id, date })),
    [run],
  );
  /** 移除指定习惯。 */
  const removeHabit = useCallback((id: string) => run(() => backend.removeHabit(id)), [run]);

  /** 新增纪念日，并保留单次或每年重复的类型。 */
  const addAnniversary = useCallback(
    (name: string, kind: "yearly" | "once", date: string, birthday?: Birthday) => {
      const trimmed = name.trim();
      if (!trimmed || !isValidDateKey(date)) return;
      run(() => backend.addAnniversary({ name: trimmed, kind, date, birthday }));
    },
    [run],
  );
  /** 移除指定纪念日。 */
  const removeAnniversary = useCallback(
    (id: string) => run(() => backend.removeAnniversary(id)),
    [run],
  );

  /** 新增提醒规则。 */
  const addReminder = useCallback(
    (input: Omit<Reminder, "id" | "createdAt" | "updatedAt" | "deletedAt">) => {
      if (!input.text.trim()) return;
      run(() => backend.addReminder({ ...input, text: input.text.trim() }));
    },
    [run],
  );
  /** 启用或停用指定提醒。 */
  const setReminderEnabled = useCallback(
    (id: string, enabled: boolean) => run(() => backend.setReminderEnabled(id, enabled)),
    [run],
  );
  /** 移除指定提醒。 */
  const removeReminder = useCallback((id: string) => run(() => backend.removeReminder(id)), [run]);
  /** 设置天气卡片使用的常住城市。 */
  const setHomeCity = useCallback(
    (city: CityRecord) => run(() => backend.setHomeCity(city)),
    [run],
  );
  /** 设置关注城市；传入空值时取消关注。 */
  const setWatchCity = useCallback(
    (city: CityRecord | null) => run(() => backend.setWatchCity(city)),
    [run],
  );
  /** 更新计划的分享对象列表。 */
  const setPlanShare = useCallback(
    (id: string, usernames: string[]) => run(() => backend.setPlanShare(id, usernames)),
    [run],
  );
  /** 更新每日记录的分享对象列表。 */
  const setNoteShare = useCallback(
    (id: string, usernames: string[]) => run(() => backend.setNoteShare(id, usernames)),
    [run],
  );
  /** 切换账号数据库并刷新状态；返回该库数据（调用方需立即更新数据引用，避免渲染时序竞态） */
  const switchAccount = useCallback((username: string | null) => {
    accountEpoch.current++;
    return backend
      .setAccount(username)
      .then((d) => {
        setData(d);
        return d;
      })
      .catch(() => undefined);
  }, []);

  /** 导入备份时全量替换（服务端校验清洗后落盘） */
  const replaceAll = useCallback((next: AppData) => run(() => backend.replaceAll(next)), [run]);

  /** 供同步引擎写回合并结果；必须同时落盘，否则刷新后旧数据复活 */
  const replaceData = useCallback((next: AppData) => {
    setData(next);
    if (typeof window !== "undefined" && window.desktopAPI) {
      return backend.replaceAll(next).then(() => {});
    } else {
      writeLocal(next);
    }
  }, []);

  return {
    data,
    /** 保存时间线变更，并刷新页面中的日历数据。 */
    saveTimeline: async (input: TimelineChange) => {
      const next = await backend.changeTimeline(input);
      setData(next);
    },
    replaceData,
    /** 批量保存成功后才刷新界面，保留错误供调用方展示。 */
    addAiPlans: async (input: AiPlanBatch) => {
      const epoch = accountEpoch.current;
      const next = await backend.addAiPlans(input);
      if (epoch !== accountEpoch.current)
        throw new Error("账号已切换，原账号的保存结果不会应用到当前界面");
      setData(next);
    },
    addPlan,
    togglePlan,
    removePlan,
    addNote,
    removeNote,
    addHabit,
    toggleHabitCheckIn,
    removeHabit,
    addAnniversary,
    removeAnniversary,
    addReminder,
    setReminderEnabled,
    removeReminder,
    setHomeCity,
    setWatchCity,
    setPlanShare,
    setNoteShare,
    switchAccount,
    replaceAll,
  };
}

/** 按日期分组；同一天内未完成在前、已完成沉底，各按创建时间排序 */
export function plansByDate(plans: Plan[]): Map<string, Plan[]> {
  const map = new Map<string, Plan[]>();
  for (const p of plans) {
    if (p.deletedAt !== null) continue;
    const list = map.get(p.date) ?? [];
    list.push(p);
    map.set(p.date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt);
  }
  return map;
}

/** 忽略已删除记录，按日期分组并按创建时间排列每日记录。 */
export function notesByDate(notes: DayNote[]): Map<string, DayNote[]> {
  const map = new Map<string, DayNote[]>();
  for (const n of notes) {
    if (n.deletedAt !== null) continue;
    const list = map.get(n.date) ?? [];
    list.push(n);
    map.set(n.date, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.createdAt - b.createdAt);
  }
  return map;
}
