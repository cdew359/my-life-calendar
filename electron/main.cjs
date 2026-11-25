const { applyAiPlans } = require("./aiPlans.cjs");
const { coerceTimelines, changeTimeline } = require("./timelines.cjs");
const { coerceBirthday } = require("./birthdayRules.cjs");
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  globalShortcut,
  nativeImage,
  screen,
  Notification,
} = require("electron");
const path = require("node:path");
const fs = require("node:fs");

// Alt+D 会霸占浏览器地址栏快捷键，全局注册用它太霸道，默认 Alt+Shift+D
const QUICK_ADD_ACCELERATOR = "Alt+Shift+D";

const argv = process.argv.slice(app.isPackaged ? 1 : 2);
const useFile = app.isPackaged || argv.includes("--dist");
const devUrl = useFile ? null : process.env.VITE_DEV_SERVER_URL || "http://localhost:5180";
const startHidden = argv.includes("--hidden");
const isSmoke = argv.includes("--smoke");
// Smoke checks always use disposable data, never the installed user profile.
if (isSmoke)
  app.setPath(
    "userData",
    fs.mkdtempSync(path.join(require("node:os").tmpdir(), "calendar-smoke-")),
  );

let mainWindow = null;
let quickWindow = null;
let tray = null;
let quitting = false;

// ── 数据：主进程是唯一数据源，data.json 落盘 ────────────

// 账号分库：登录账号各用 data-<账号>.json；未登录/登录前用无主库 data.json
const legacyDataFile = path.join(app.getPath("userData"), "data.json");
let dataFile = legacyDataFile;
let currentAccount = null;
const legacyPlansFile = path.join(app.getPath("userData"), "plans.json");
// 提前定义：loadDataFromDisk 在模块加载期就要读它做旧位置迁移
const weatherFile = path.join(app.getPath("userData"), "weather.json");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** 格式 + 真实日历日期双重校验 */
function validDate(v) {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** 创建包含各类空列表的初始日历数据。 */
function emptyData() {
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

/** 城市清洗：与前端 coerceCity 同规则 */
function validCity(v) {
  if (!v || typeof v !== "object") return null;
  if (typeof v.name !== "string" || !v.name.trim()) return null;
  const lat = Number(v.lat);
  const lon = Number(v.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
    return null;
  return { name: v.name.trim().slice(0, 24), lat, lon };
}

/** 将分类值规范为工作或生活，未知值按生活处理。 */
function coerceDomain(v) {
  return v === "work" ? "work" : "life";
}

/** 清洗磁盘中的计划列表，补齐时间戳和删除状态等兼容字段。 */
function coercePlans(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        validDate(p.date) &&
        typeof p.text === "string" &&
        p.text.trim(),
    )
    .map((p) => {
      const createdAt = typeof p.createdAt === "number" ? p.createdAt : Date.now();
      return {
        id: p.id,
        date: p.date,
        text: p.text.trim(),
        done: p.done === true,
        doneAt: typeof p.doneAt === "number" ? p.doneAt : null,
        createdAt,
        domain: coerceDomain(p.domain),
        updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : createdAt,
        deletedAt: typeof p.deletedAt === "number" ? p.deletedAt : null,
      };
    });
}

/** 加载并清洗当前账号数据，兼容旧计划文件及城市设置迁移。 */
function loadDataFromDisk() {
  // data.json（v2）
  try {
    const raw = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (raw && typeof raw === "object") {
      const data = emptyData();
      data.plans = coercePlans(raw.plans);
      data.timelines = coerceTimelines(raw.timelines, data.plans);
      if (Array.isArray(raw.notes)) {
        data.notes = raw.notes
          .filter((n) => n && validDate(n.date) && typeof n.text === "string" && n.text.trim())
          .map((n) => {
            const createdAt = typeof n.createdAt === "number" ? n.createdAt : Date.now();
            return {
              id: typeof n.id === "string" ? n.id : newId(),
              date: n.date,
              text: n.text.trim(),
              createdAt,
              domain: coerceDomain(n.domain),
              updatedAt: typeof n.updatedAt === "number" ? n.updatedAt : createdAt,
              deletedAt: typeof n.deletedAt === "number" ? n.deletedAt : null,
            };
          });
      }
      if (Array.isArray(raw.habits)) {
        data.habits = raw.habits
          .filter((h) => h && typeof h.text === "string" && h.text.trim())
          .map((h) => {
            const createdAt = typeof h.createdAt === "number" ? h.createdAt : Date.now();
            return {
              id: typeof h.id === "string" ? h.id : newId(),
              text: h.text.trim(),
              domain: coerceDomain(h.domain),
              createdAt,
              archivedAt: typeof h.archivedAt === "number" ? h.archivedAt : null,
              checkIns: Array.isArray(h.checkIns)
                ? h.checkIns.filter((d) => validDate(d)).sort()
                : [],
              updatedAt: typeof h.updatedAt === "number" ? h.updatedAt : createdAt,
              deletedAt: typeof h.deletedAt === "number" ? h.deletedAt : null,
            };
          });
      }
      if (Array.isArray(raw.anniversaries)) {
        data.anniversaries = raw.anniversaries
          .filter((a) => a && typeof a.name === "string" && a.name.trim() && validDate(a.date))
          .map((a) => {
            const createdAt = typeof a.createdAt === "number" ? a.createdAt : Date.now();
            return {
              id: typeof a.id === "string" ? a.id : newId(),
              name: a.name.trim(),
              kind: a.kind === "once" ? "once" : "yearly",
              date: a.date,
              ...(coerceBirthday(a.birthday) ? { birthday: coerceBirthday(a.birthday) } : {}),
              createdAt,
              updatedAt: typeof a.updatedAt === "number" ? a.updatedAt : createdAt,
              deletedAt: typeof a.deletedAt === "number" ? a.deletedAt : null,
            };
          });
      }
      if (Array.isArray(raw.reminders)) {
        data.reminders = raw.reminders
          .filter(
            (x) => x && typeof x.text === "string" && x.text.trim() && TIME_RE.test(String(x.time)),
          )
          .map((x) => {
            const createdAt = typeof x.createdAt === "number" ? x.createdAt : Date.now();
            const mode = x.mode === "periodic" ? "periodic" : "weekly";
            let weekdays = Array.isArray(x.weekdays)
              ? Array.from(
                  new Set(
                    x.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7),
                  ),
                ).sort((a, b) => a - b)
              : [1, 2, 3, 4, 5];
            if (mode === "weekly" && weekdays.length === 0) weekdays = [1, 2, 3, 4, 5];
            const periodRaw = Number(x.periodDays);
            return {
              id: typeof x.id === "string" ? x.id : newId(),
              text: x.text.trim(),
              time: x.time,
              mode,
              weekdays,
              periodDays: Number.isInteger(periodRaw) && periodRaw >= 1 ? periodRaw : 1,
              anchorDate: validDate(x.anchorDate) ? x.anchorDate : "2026-01-01",
              enabled: x.enabled !== false,
              createdAt,
              updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : createdAt,
              deletedAt: typeof x.deletedAt === "number" ? x.deletedAt : null,
            };
          });
      }
      /** 清洗带更新时间的城市设置，非法城市不参与本地恢复。 */
      const coerceSingle = (v) => {
        const city = validCity(v && v.city);
        if (!city) return null;
        return { city, updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : 0 };
      };
      data.homeCity = coerceSingle(raw.homeCity);
      data.watchCity = coerceSingle(raw.watchCity);
      if (!data.homeCity) {
        // 旧版只设过天气城市（weather.json）→ 迁移为常驻地区
        try {
          const loc = validCity(JSON.parse(fs.readFileSync(weatherFile, "utf8")));
          if (loc) data.homeCity = { city: loc, updatedAt: 0 };
        } catch {
          // 无旧位置，保持为空
        }
      }
      return data;
    }
  } catch {
    // 文件不存在或损坏，继续尝试迁移
  }
  // 旧版 plans.json（v1 数组）→ v2；只归无主库，账号库缺失一律从空开始
  if (dataFile === legacyDataFile) {
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPlansFile, "utf8"));
      if (Array.isArray(legacy)) {
        const data = emptyData();
        data.plans = coercePlans(legacy);
        return data;
      }
    } catch {
      // 无旧数据，返回空
    }
  }
  return emptyData();
}

let seq = 0;
/** 生成新条目的唯一标识。 */
function newId() {
  seq += 1;
  return `${Date.now().toString(36)}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

let dataState = loadDataFromDisk();

/** 将主进程数据写入临时文件后原子替换当前账号的数据文件。 */
function persist() {
  const tmp = `${dataFile}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(dataState, null, 2));
  fs.renameSync(tmp, dataFile);
}

// 启动即落盘一次：旧版天气城市迁移/字段清洗结果立刻可见，不只留在内存
try {
  persist();
} catch (err) {
  console.warn("启动落盘失败:", err && err.message);
}

/** 把主进程中的最新日历快照通知所有桌面窗口。 */
function broadcast() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("data:changed", dataState);
  }
}

/** 持久化一次数据变更，通知各窗口并返回最新快照。 */
function commit() {
  persist();
  broadcast();
  return dataState;
}

ipcMain.handle("data:changeTimeline", (_e, input) => {
  const previous = dataState;
  dataState = changeTimeline(dataState, input);
  try {
    return commit();
  } catch (error) {
    dataState = previous;
    throw error;
  }
});
ipcMain.handle("data:load", () => dataState);

/** AI 批次先校验，写盘失败恢复内存，避免半批成功。 */
ipcMain.handle("data:addAiPlans", (event, input) => {
  if (event.sender !== mainWindow?.webContents) throw new Error("INVALID_SENDER");
  const previous = dataState;
  dataState = applyAiPlans(dataState, input, currentAccount);
  try {
    return commit();
  } catch (failure) {
    dataState = previous;
    throw failure;
  }
});

ipcMain.handle("data:addPlan", (_e, input) => {
  if (!input || !validDate(input.date) || typeof input.text !== "string" || !input.text.trim()) {
    throw new Error("INVALID_INPUT");
  }
  const now = Date.now();
  dataState.plans = [
    ...dataState.plans,
    {
      id: newId(),
      date: input.date,
      text: input.text.trim(),
      done: false,
      doneAt: null,
      createdAt: now,
      domain: coerceDomain(input.domain),
      updatedAt: now,
      deletedAt: null,
    },
  ];
  return commit();
});

ipcMain.handle("data:togglePlan", (_e, input) => {
  if (!input || typeof input.id !== "string") throw new Error("INVALID_INPUT");
  dataState.plans = dataState.plans.map((p) =>
    p.id === input.id
      ? { ...p, done: !p.done, doneAt: !p.done ? Date.now() : null, updatedAt: Date.now() }
      : p,
  );
  return commit();
});

ipcMain.handle("data:removePlan", (_e, input) => {
  if (!input || typeof input.id !== "string") throw new Error("INVALID_INPUT");
  dataState.plans = dataState.plans.map((p) =>
    p.id === input.id ? { ...p, deletedAt: Date.now(), updatedAt: Date.now() } : p,
  );
  return commit();
});

ipcMain.handle("data:addNote", (_e, input) => {
  if (!input || !validDate(input.date) || typeof input.text !== "string" || !input.text.trim()) {
    throw new Error("INVALID_INPUT");
  }
  const noteTime = Date.now();
  dataState.notes = [
    ...dataState.notes,
    {
      id: newId(),
      date: input.date,
      text: input.text.trim(),
      createdAt: noteTime,
      domain: coerceDomain(input.domain),
      updatedAt: noteTime,
      deletedAt: null,
    },
  ];
  return commit();
});

ipcMain.handle("data:removeNote", (_e, input) => {
  if (!input || typeof input.id !== "string") throw new Error("INVALID_INPUT");
  dataState.notes = dataState.notes.map((n) =>
    n.id === input.id ? { ...n, deletedAt: Date.now(), updatedAt: Date.now() } : n,
  );
  return commit();
});

ipcMain.handle("data:addHabit", (_e, input) => {
  if (!input || typeof input.text !== "string" || !input.text.trim())
    throw new Error("INVALID_INPUT");
  const habitTime = Date.now();
  dataState.habits = [
    ...dataState.habits,
    {
      id: newId(),
      text: input.text.trim(),
      domain: coerceDomain(input.domain),
      createdAt: habitTime,
      archivedAt: null,
      checkIns: [],
      updatedAt: habitTime,
      deletedAt: null,
    },
  ];
  return commit();
});

ipcMain.handle("data:toggleHabitCheckIn", (_e, input) => {
  if (!input || typeof input.id !== "string" || !validDate(input.date))
    throw new Error("INVALID_INPUT");
  dataState.habits = dataState.habits.map((h) => {
    if (h.id !== input.id) return h;
    const checkIns = h.checkIns.includes(input.date)
      ? h.checkIns.filter((d) => d !== input.date)
      : [...h.checkIns, input.date].sort();
    return { ...h, checkIns, updatedAt: Date.now() };
  });
  return commit();
});

ipcMain.handle("data:removeHabit", (_e, input) => {
  if (!input || typeof input.id !== "string") throw new Error("INVALID_INPUT");
  dataState.habits = dataState.habits.map((h) =>
    h.id === input.id ? { ...h, deletedAt: Date.now(), updatedAt: Date.now() } : h,
  );
  return commit();
});

ipcMain.handle("data:addAnniversary", (_e, input) => {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    !validDate(input.date) ||
    (input.kind !== "yearly" && input.kind !== "once")
  ) {
    throw new Error("INVALID_INPUT");
  }
  const annTime = Date.now();
  if (input.birthday !== undefined && !coerceBirthday(input.birthday))
    throw new Error("INVALID_INPUT");
  dataState.anniversaries = [
    ...dataState.anniversaries,
    {
      id: newId(),
      name: input.name.trim(),
      kind: input.kind,
      date: input.date,
      ...(coerceBirthday(input.birthday) ? { birthday: coerceBirthday(input.birthday) } : {}),
      createdAt: annTime,
      updatedAt: annTime,
      deletedAt: null,
    },
  ];
  return commit();
});

ipcMain.handle("data:removeAnniversary", (_e, input) => {
  if (!input || typeof input.id !== "string") throw new Error("INVALID_INPUT");
  dataState.anniversaries = dataState.anniversaries.map((a) =>
    a.id === input.id ? { ...a, deletedAt: Date.now(), updatedAt: Date.now() } : a,
  );
  return commit();
});

ipcMain.handle("data:addReminder", (_e, input) => {
  if (
    !input ||
    typeof input.text !== "string" ||
    !input.text.trim() ||
    !TIME_RE.test(String(input.time))
  ) {
    throw new Error("INVALID_INPUT");
  }
  const now = Date.now();
  dataState.reminders = [
    ...dataState.reminders,
    {
      id: newId(),
      text: input.text.trim(),
      time: input.time,
      mode: input.mode === "periodic" ? "periodic" : "weekly",
      weekdays: Array.isArray(input.weekdays) ? input.weekdays : [1, 2, 3, 4, 5],
      periodDays:
        Number.isInteger(input.periodDays) && input.periodDays >= 1 ? input.periodDays : 1,
      anchorDate: validDate(input.anchorDate) ? input.anchorDate : "2026-01-01",
      enabled: input.enabled !== false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
  ];
  return commit();
});

ipcMain.handle("data:setReminderEnabled", (_e, input) => {
  if (!input || typeof input.id !== "string" || typeof input.enabled !== "boolean")
    throw new Error("INVALID_INPUT");
  dataState.reminders = dataState.reminders.map((r) =>
    r.id === input.id ? { ...r, enabled: input.enabled, updatedAt: Date.now() } : r,
  );
  return commit();
});

ipcMain.handle("data:removeReminder", (_e, input) => {
  if (!input || typeof input.id !== "string") throw new Error("INVALID_INPUT");
  dataState.reminders = dataState.reminders.map((r) =>
    r.id === input.id ? { ...r, deletedAt: Date.now(), updatedAt: Date.now() } : r,
  );
  return commit();
});

ipcMain.handle("data:setHomeCity", (_e, city) => {
  const cleaned = validCity(city);
  if (!cleaned) throw new Error("INVALID_INPUT");
  dataState.homeCity = { city: cleaned, updatedAt: Date.now() };
  return commit();
});

ipcMain.handle("data:setWatchCity", (_e, city) => {
  if (city === null || city === undefined) {
    dataState.watchCity = null;
    return commit();
  }
  const cleaned = validCity(city);
  if (!cleaned) throw new Error("INVALID_INPUT");
  dataState.watchCity = { city: cleaned, updatedAt: Date.now() };
  return commit();
});

ipcMain.handle("data:setPlanShare", (_e, input) => {
  if (!input || typeof input.id !== "string" || !Array.isArray(input.usernames))
    throw new Error("INVALID_INPUT");
  const usernames = Array.from(
    new Set(
      input.usernames
        .filter((u) => typeof u === "string" && u.trim())
        .map((u) => u.trim().slice(0, 24)),
    ),
  );
  dataState.plans = dataState.plans.map((p) =>
    p.id === input.id
      ? { ...p, shareWith: usernames.length > 0 ? usernames : undefined, updatedAt: Date.now() }
      : p,
  );
  return commit();
});

ipcMain.handle("data:setNoteShare", (_e, input) => {
  if (!input || typeof input.id !== "string" || !Array.isArray(input.usernames))
    throw new Error("INVALID_INPUT");
  const usernames = Array.from(
    new Set(
      input.usernames
        .filter((u) => typeof u === "string" && u.trim())
        .map((u) => u.trim().slice(0, 24)),
    ),
  );
  dataState.notes = dataState.notes.map((n) =>
    n.id === input.id
      ? { ...n, shareWith: usernames.length > 0 ? usernames : undefined, updatedAt: Date.now() }
      : n,
  );
  return commit();
});

const ACCOUNT_RE = /^[\p{L}\p{N}_-]{1,24}$/u;
ipcMain.handle("data:setAccount", (_e, username) => {
  if (username === null || username === undefined || username === "") {
    currentAccount = null;
    dataFile = legacyDataFile;
    dataState = loadDataFromDisk();
    return commit();
  }
  const name = String(username);
  if (!ACCOUNT_RE.test(name)) throw new Error("INVALID_INPUT");
  const file = path.join(app.getPath("userData"), `data-${name}.json`);
  if (!fs.existsSync(file)) {
    // 无主库只允许被第一个登录的账号认领一次（与 web 端规则一致）
    const claimed = fs.readdirSync(app.getPath("userData")).some((f) => /^data-.+\.json$/.test(f));
    if (!claimed && fs.existsSync(legacyDataFile)) {
      fs.renameSync(legacyDataFile, file);
    }
  }
  currentAccount = name;
  dataFile = file;
  dataState = loadDataFromDisk();
  return commit();
});

ipcMain.handle("data:replaceAll", (_e, input) => {
  if (!input || typeof input !== "object") throw new Error("INVALID_INPUT");
  // 先落盘再走统一读取清洗，最后原子写回干净数据并广播
  fs.writeFileSync(dataFile, JSON.stringify(input));
  dataState = loadDataFromDisk();
  return commit();
});

const firedFile = path.join(app.getPath("userData"), "reminder-state.json");

/** 读取提醒触发记录，文件缺失或损坏时返回空记录。 */
function loadFired() {
  try {
    const raw = JSON.parse(fs.readFileSync(firedFile, "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

let firedState = loadFired();

/** 保存提醒触发记录，用于应用重启后的通知去重。 */
function saveFired() {
  try {
    fs.writeFileSync(firedFile, JSON.stringify(firedState, null, 2));
  } catch {
    // 状态文件写失败只影响去重，不影响触发
  }
}

const briefingPending = new Map();
ipcMain.handle("briefing:show", (event, input) => {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    !input ||
    input.account !== currentAccount ||
    typeof input.body !== "string" ||
    !input.body ||
    input.body.length > 100000
  )
    return false;
  const birthday = input.birthdayKey !== undefined;
  if (
    birthday &&
    (typeof input.birthdayKey !== "string" ||
      !/^[\w-]+:\d{4}-\d{2}-\d{2}:(eve|morning)$/.test(input.birthdayKey) ||
      input.birthdayKey.length > 180)
  )
    return false;
  const key =
    (birthday ? "__birthday:" + input.birthdayKey + ":" : "__briefing:") +
    (currentAccount === null ? "local" : "account:" + currentAccount);
  const today = localDateKey();
  if (firedState[key] === today) return true;
  if (briefingPending.has(key)) return briefingPending.get(key);
  const operation = new Promise((resolve) => {
    let notice,
      timer,
      settled = false;
    /** 只结算一次简报通知结果，成功显示时记录当天已触发。 */
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (ok) {
        firedState[key] = today;
        saveFired();
      }
      resolve(ok);
    };
    try {
      notice = new Notification({
        title: birthday ? "家人生日提醒 🎂" : "明日简报",
        body: input.body,
      });
      notice.on("click", showMainWindow);
      notice.once("show", () => finish(true));
      notice.once("failed", () => finish(false));
      timer = setTimeout(() => finish(false), 5000);
      notice.show();
    } catch {
      finish(false);
    }
  });
  briefingPending.set(key, operation);
  void operation.finally(() => briefingPending.delete(key));
  return operation;
});

/** 按本机时区生成今天的 YYYY-MM-DD 日期键。 */
function localDateKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

const HOLIDAY_DATA = require(path.join(__dirname, "..", "resources", "holidays.json"));

/** 查询某一天是否为法定假期或调休工作日。 */
function holidayInfoOfKey(dateStr) {
  if (HOLIDAY_DATA.adjusted[dateStr]) return "adjusted";
  for (const r of HOLIDAY_DATA.ranges) {
    if (dateStr >= r.start && dateStr <= r.end) return "holiday";
  }
  return null;
}

/** 结合调休信息和星期判断今天是否为工作日。 */
function isChineseWorkdayToday() {
  const info = holidayInfoOfKey(localDateKey());
  if (info) return info === "adjusted";
  const wd = ((new Date().getDay() + 6) % 7) + 1;
  return wd <= 5;
}

/** 按每周重复、调休或间隔天数规则判断提醒是否适用于今天。 */
function reminderAppliesToday(r) {
  if (r.mode === "weekly") {
    const sorted = [...r.weekdays].sort((a, b) => a - b);
    if (sorted.join(",") === "1,2,3,4,5") return isChineseWorkdayToday();
    const wd = ((new Date().getDay() + 6) % 7) + 1;
    return r.weekdays.includes(wd);
  }
  const today = localDateKey();
  if (today < r.anchorDate) return false;
  const a = new Date(
    Number(r.anchorDate.slice(0, 4)),
    Number(r.anchorDate.slice(5, 7)) - 1,
    Number(r.anchorDate.slice(8, 10)),
  );
  a.setHours(12, 0, 0, 0);
  const b = new Date();
  b.setHours(12, 0, 0, 0);
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86400000);
  return diffDays % Math.max(1, r.periodDays) === 0;
}

/** 检查已启用且到时的提醒，发送桌面通知并保存去重记录。 */
function checkReminders() {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  const today = localDateKey();
  let changed = false;
  for (const r of dataState.reminders) {
    if (r.deletedAt !== null || !r.enabled || firedState[r.id] === today) continue;
    if (!reminderAppliesToday(r)) continue;
    const [h, m] = r.time.split(":").map(Number);
    if (nowMinutes < h * 60 + m) continue;
    firedState[r.id] = today;
    changed = true;
    try {
      const notice = new Notification({ title: "日历表提醒", body: r.text });
      notice.on("click", showMainWindow);
      notice.show();
    } catch (err) {
      console.warn("通知发送失败:", err && err.message);
    }
  }
  if (changed) saveFired();

  // 生日上午和晚间也唤醒渲染层检查；各功能自行判断时段、同步和去重。
  if (
    ((nowMinutes >= 9 * 60 && nowMinutes < 12 * 60) || nowMinutes >= 20 * 60) &&
    mainWindow &&
    !mainWindow.isDestroyed()
  ) {
    mainWindow.webContents.send("briefing:check");
  }
}

// ── 窗口 ────────────────────────────────────────────────

/** 返回打包后网页入口文件的绝对路径。 */
function indexHtml() {
  return path.join(__dirname, "..", "dist", "index.html");
}

/** 在主屏工作区创建日历窗口，连接预加载接口并处理关闭与隐藏行为。 */
function createMainWindow() {
  // 多显示器环境下默认居中可能把窗口顶出主屏可视区，显式在主屏工作区内居中
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = 1180;
  const height = 920;
  mainWindow = new BrowserWindow({
    width,
    height,
    x: workArea.x + 120,
    y: workArea.y + 80,
    minWidth: 720,
    minHeight: 560,
    show: !startHidden,
    backgroundColor: "#f6f5f1",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      // 关窗驻留托盘后渲染进程仍在跑同步定时器，关掉节流保证 60 秒轮询不降频
      backgroundThrottling: false,
    },
  });
  mainWindow.on("close", (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(indexHtml());
  }
}

/** 创建无边框快速添加窗口，并在失去焦点时隐藏。 */
function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: 520,
    height: 176,
    frame: false,
    resizable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#fffdf9",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  quickWindow.on("blur", () => {
    if (quickWindow) quickWindow.hide();
  });
  quickWindow.on("closed", () => {
    quickWindow = null;
  });
  if (devUrl) {
    quickWindow.loadURL(`${devUrl}?window=quick`);
  } else {
    quickWindow.loadFile(indexHtml(), { query: { window: "quick" } });
  }
}

/** 按需创建主窗口，随后显示窗口并取得焦点。 */
function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isVisible()) {
    mainWindow.focus();
  } else {
    mainWindow.show();
    mainWindow.focus();
  }
}

/** 按需创建快速添加窗口，准备就绪后显示并取得焦点。 */
function showQuickAdd() {
  if (!quickWindow) {
    createQuickWindow();
    quickWindow.once("ready-to-show", () => {
      quickWindow.show();
      quickWindow.focus();
    });
  } else {
    quickWindow.show();
    quickWindow.focus();
  }
}

ipcMain.on("quick-add:hide", () => {
  if (quickWindow) quickWindow.hide();
});

// ── 天气位置（旧版单城市；简报优先用 data.json 的常驻/出行） ──

/** 读取并校验桌面天气城市设置，读取失败时返回空值。 */
function readWeatherFile() {
  try {
    return validCity(JSON.parse(fs.readFileSync(weatherFile, "utf8")));
  } catch {
    return null;
  }
}

ipcMain.handle("weather:setLocation", (_e, loc) => {
  if (!loc || typeof loc.lat !== "number" || typeof loc.lon !== "number") {
    throw new Error("INVALID_INPUT");
  }
  fs.writeFileSync(
    weatherFile,
    JSON.stringify({ name: String(loc.name || "我的位置"), lat: loc.lat, lon: loc.lon }, null, 2),
  );
});

/** 把 WMO 天气代码转换为中文天气描述。 */
function wmoText(code) {
  if (code === 0) return "晴";
  if (code === 1) return "晴间多云";
  if (code === 2) return "多云";
  if (code === 3) return "阴";
  if (code === 45 || code === 48) return "雾";
  if (code >= 51 && code <= 57) return "毛毛雨";
  if (code >= 61 && code <= 67) return "雨";
  if (code >= 71 && code <= 77) return "雪";
  if (code >= 80 && code <= 82) return "阵雨";
  if (code === 85 || code === 86) return "阵雪";
  if (code >= 95) return "雷雨";
  return "—";
}

// ── 托盘 ────────────────────────────────────────────────

/** 返回应用托盘图标的绝对路径。 */
function iconPath() {
  return path.join(__dirname, "..", "resources", "icon.png");
}

/** 创建托盘图标及显示窗口、快速添加、开机自启和退出菜单。 */
function createTray() {
  const icon = nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip(`日历表 — ${QUICK_ADD_ACCELERATOR} 快速添加`);

  const template = [
    { label: "显示日历表", click: showMainWindow },
    { label: "快速添加", accelerator: QUICK_ADD_ACCELERATOR, click: showQuickAdd },
    {
      label: "开机自启",
      type: "checkbox",
      // 开发态 execPath 指向 electron.exe，自启无意义
      enabled: app.isPackaged,
      checked: app.getLoginItemSettings().openAtLogin,
      /** 根据托盘勾选状态更新开机自启设置。 */
      click: (item) => {
        app.setLoginItemSettings({
          openAsHidden: true,
          openAtLogin: item.checked,
          path: process.execPath,
          args: ["--hidden"],
        });
      },
    },
    { type: "separator" },
    {
      label: "退出",
      /** 标记主动退出并结束桌面应用。 */
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ];
  tray.setContextMenu(Menu.buildFromTemplate(template));
  tray.on("click", () => {
    if (mainWindow && mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      showMainWindow();
    }
  });
}

// ── 冒烟模式：加载页面后跑一遍 IPC 往返再退出 ───────────

/** 仅用隔离资料和专用测试账号验证客户端 AI、保存、同步与日记引用链路。 */
async function runAiSmoke() {
  const server = process.env.CAL_SYNC_URL || "";
  const username = process.env.CAL_SYNC_USER || "";
  const password = process.env.CAL_SYNC_PASSWORD || "";
  if (!/^ai_test_[a-f0-9]{12}$/.test(username) || !server || !password)
    throw new Error("AI smoke requires a disposable test account");
  return mainWindow.webContents.executeJavaScript(`(async () => {
    const server = ${JSON.stringify(server)}, username = ${JSON.stringify(username)};
    const login = await fetch(server+'/api/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:${JSON.stringify(password)}})}).then(r=>r.json());
    if (!login.token) throw Error('AI smoke login failed');
    const api = window.desktopAPI;
    await api.data.setAccount(username);
    localStorage.setItem('calendar.sync.server',server);
    localStorage.setItem('calendar.sync.user',username);
    localStorage.setItem('calendar.sync.token',login.token);
    const headers = {authorization:'Bearer '+login.token,'content-type':'application/json'};
    const pulled = await fetch(server+'/api/data',{headers}).then(r=>r.json());
    await api.data.replaceAll(pulled.data);
    const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
    const wait = async predicate => {
      for (let i=0;i<180;i++) { if(predicate()) return; await pause(250); }
      throw Error('AI smoke UI wait timed out: '+predicate.toString());
    };
    const button = text => [...document.querySelectorAll('button')].find(b=>b.textContent.trim()===text);
    const input = (selector,value) => {
      const element=document.querySelector(selector);
      const prototype=element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype,'value').set.call(element,value);
      element.dispatchEvent(new Event('input',{bubbles:true}));
    };
    await wait(()=>document.querySelector('.login-skip') || document.querySelector('.ai-entry'));
    document.querySelector('.login-skip')?.click();
    await wait(()=>document.querySelector('.ai-entry'));
    const beforeIds=new Set((await api.data.load()).plans.map(p=>p.id));
    document.querySelector('.ai-entry').click();
    await wait(()=>document.querySelector('.ai-dialog[open]'));
    input('.ai-dialog textarea','2026年11月21日15:00学习Spring AI，预计30分钟。');
    document.querySelector('.ai-dialog .ai-consent input').click();
    await wait(()=>button('生成计划草稿') && !button('生成计划草稿').disabled);
    button('生成计划草稿').click();
    await wait(()=>document.querySelectorAll('.ai-card').length===1);
    await wait(()=>button('确认所选并保存计划') && !button('确认所选并保存计划').disabled);
    button('确认所选并保存计划').click();
    await wait(()=>document.querySelector('.ai-dialog').textContent.includes('已保存到本机计划'));
    const data=await api.data.load();
    const saved=data.plans.filter(p=>p.id.startsWith('ai:') && !p.deletedAt && !beforeIds.has(p.id));
    if(saved.length!==1 || saved[0].date!=='2026-11-21') throw Error('AI IPC save failed');
    const pushed=await fetch(server+'/api/data',{method:'POST',headers,body:JSON.stringify({data})});
    if(!pushed.ok) throw Error('AI plan sync failed');
    const again=await fetch(server+'/api/data',{headers}).then(r=>r.json());
    if(!again.data.plans.some(p=>p.id===saved[0].id)) throw Error('AI plan round-trip failed');
    button('问问日记').click();
    await wait(()=>document.querySelector('.ai-dialog > label input:not([type])'));
    input('.ai-dialog textarea','部署验证中网关超时是怎么解决的？');
    input('.ai-dialog > label input:not([type])','部署验证');
    input('.ai-dialog input[type=date]','2026-11-01');
    const dates=document.querySelectorAll('.ai-dialog input[type=date]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(dates[1],'2026-11-30');
    dates[1].dispatchEvent(new Event('input',{bubbles:true}));
    await wait(()=>button('查找并回答') && !button('查找并回答').disabled);
    button('查找并回答').click();
    await wait(()=>button('打开日记原文 ↗'));
    if(!document.querySelector('.ai-result').textContent.includes('35')) throw Error('AI cited answer failed');
    button('打开日记原文 ↗').click();
    await wait(()=>!document.querySelector('.ai-dialog[open]') && document.querySelector('.diary-dialog[open]'));
    return {generated:true,persisted:true,synced:true,rag:true,sourceOpened:true};
  })()`);
}

/** 在隔离的测试用户目录中检查桌面页面加载和数据操作，不使用安装用户的真实资料。 */
function runSmoke() {
  const syncUrl = process.env.CAL_SYNC_URL ?? "";
  const syncPassword = process.env.CAL_SYNC_PASSWORD ?? "";
  const syncUser = process.env.CAL_SYNC_USER ?? "";
  const wc = mainWindow.webContents;
  wc.on("did-fail-load", (_e, code, desc) => {
    console.error(`SMOKE_LOAD_FAIL ${code} ${desc}`);
    app.exit(1);
  });
  wc.on("did-finish-load", () => {
    wc.executeJavaScript(
      `(async () => {
        const api = window.desktopAPI;
        if (!api) return { ok: false, step: "preload" };
        const d0 = await api.data.load();
        let d = await api.data.addPlan({ date: "2099-01-01", text: "smoke", domain: "work" });
        const planId = d.plans[d.plans.length - 1].id;
        d = await api.data.togglePlan(planId);
        const toggled = (d.plans.find((p) => p.id === planId) || {}).done === true;
        d = await api.data.addHabit({ text: "smoke habit", domain: "life" });
        const habitId = d.habits[d.habits.length - 1].id;
        d = await api.data.toggleHabitCheckIn({ id: habitId, date: "2099-01-01" });
        const checked = (d.habits.find((h) => h.id === habitId) || {}).checkIns.includes("2099-01-01");
        d = await api.data.addNote({ date: "2099-01-01", text: "smoke note", domain: "work" });
        const noteId = d.notes[d.notes.length - 1].id;
        d = await api.data.addAnniversary({ name: "smoke", kind: "yearly", date: "2099-01-01", birthday: { calendar: "lunar", month: 2, day: 30, leapMonth: true } });
        const annId = d.anniversaries[d.anniversaries.length - 1].id;
        const lineNow = Date.now();
        const step = { ...d.plans.find(p => p.id === planId), id: "smoke-private-step" };
        const line = { id: "smoke-timeline", name: "跨天测试", date: "2099-01-02", startTime: "23:00", endTime: "00:30", stepsMode: true, createdAt: lineNow, updatedAt: lineNow, deletedAt: null, items: [{ id: "smoke-item", planId: step.id, durationMinutes: 90, step }] };
        d = await api.data.changeTimeline({ timeline: line, expectedUpdatedAt: null, publishGoal: true });
        const timelineSaved = d.timelines.some(t => t.id === line.id && t.items[0].durationMinutes === 90);
        d = await api.data.replaceAll(d);
        const birthdayReloaded = d.anniversaries.find(a => a.id === annId)?.birthday?.calendar === "lunar" && d.anniversaries.find(a => a.id === annId)?.birthday?.leapMonth === true;
        const timelineReloaded = d.timelines.some(t => t.id === line.id && t.items[0].step.text === step.text && t.goalPlanId === "timeline-goal:smoke-timeline") && d.plans.some(p => p.id === "timeline-goal:smoke-timeline" && p.text === line.name) && !d.plans.some(p => p.id === step.id);
        const savedLine = d.timelines.find(t => t.id === line.id);
        d = await api.data.changeTimeline({ timeline: { ...savedLine, deletedAt: Date.now() }, expectedUpdatedAt: savedLine.updatedAt });
        d = await api.data.removePlan(planId);
        d = await api.data.removePlan("timeline-goal:smoke-timeline");
        d = await api.data.removeHabit(habitId);
        d = await api.data.removeNote(noteId);
        d = await api.data.removeAnniversary(annId);
        const alive = (arr) => arr.filter((x) => x.deletedAt === null).length;
        const same =
          alive(d.plans) === alive(d0.plans) &&
          alive(d.habits) === alive(d0.habits) &&
          alive(d.notes) === alive(d0.notes) &&
          alive(d.anniversaries) === alive(d0.anniversaries);
        const planCount = alive(d.plans);
        // 可选同步回路检查：CAL_SYNC_URL + CAL_SYNC_PASSWORD 环境变量提供
        // 在真实渲染进程（file:// 跨源 + CORS）里跑 登录→拉取→推送
        let sync = "skipped";
        if (${JSON.stringify(syncUrl)} && ${JSON.stringify(syncUser)} && ${JSON.stringify(syncPassword)}) {
          try {
            const login = await fetch(${JSON.stringify(syncUrl)} + "/api/login", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ username: ${JSON.stringify(syncUser)}, password: ${JSON.stringify(syncPassword)} }),
            }).then((r) => r.json());
            if (!login.token) throw new Error("no token");
            const auth = { authorization: "Bearer " + login.token };
            const pulled = await fetch(${JSON.stringify(syncUrl)} + "/api/data", { headers: auth }).then((r) => r.json());
            if (!pulled.data) throw new Error("pull failed");
            const pushed = await fetch(${JSON.stringify(syncUrl)} + "/api/data", {
              method: "POST",
              headers: { ...auth, "content-type": "application/json" },
              body: JSON.stringify({ data: pulled.data }),
            }).then((r) => r.json());
            if (pushed.version === undefined) throw new Error("push failed");
            sync = "ok";
          } catch (err) {
            sync = "fail:" + (err && err.message);
          }
        }
        const briefingBridge = typeof api.briefing?.onCheck === 'function' && await api.briefing.show('', null) === false;
        return { ok: same && toggled && checked && timelineSaved && timelineReloaded && birthdayReloaded && briefingBridge && typeof api.briefing.showBirthday === "function" && !sync.startsWith("fail"), plans: alive(d0.plans) + "->" + planCount, birthdayReloaded, sync };
      })()`,
    )
      .then(async (result) => {
        if (result && result.ok) {
          if (process.env.CAL_AI_SMOKE === "1") {
            const ai = await runAiSmoke();
            console.log(`AI_SMOKE_OK ${JSON.stringify(ai)}`);
          }
          console.log(`SMOKE_OK plans=${result.plans} sync=${result.sync} preload=true`);
          app.exit(0);
        } else {
          console.error(`SMOKE_FAIL ${JSON.stringify(result)}`);
          app.exit(1);
        }
      })
      .catch((err) => {
        console.error(`SMOKE_FAIL ${err && err.message}`);
        app.exit(1);
      });
  });
}

// ── 生命周期 ────────────────────────────────────────────

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", showMainWindow);

  app.whenReady().then(() => {
    createMainWindow();

    if (isSmoke) {
      runSmoke();
    } else {
      createTray();
      setInterval(checkReminders, 30_000);
      checkReminders();
      const registered = globalShortcut.register(QUICK_ADD_ACCELERATOR, showQuickAdd);
      if (!registered) {
        console.warn(`全局快捷键 ${QUICK_ADD_ACCELERATOR} 注册失败，可从托盘菜单使用快速添加`);
      }
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().filter((w) => w !== quickWindow).length === 0) {
        createMainWindow();
      }
    });
  });

  app.on("before-quit", () => {
    quitting = true;
    globalShortcut.unregisterAll();
  });

  // 常驻托盘：关窗不退出，退出只走托盘菜单
  app.on("window-all-closed", () => {
    // 不调用 app.quit()
  });
}
