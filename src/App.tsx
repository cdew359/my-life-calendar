import { browserStorage as localStorage } from "./lib/browserStorage";
import TimelinePanel from "./components/TimelinePanel";
import DiaryPanel from "./components/DiaryPanel";
import AiPanel from "./components/AiPanel";
import { onDay } from "./lib/timelines";
import CalendarBuddy from "./components/CalendarBuddy";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { addMonths, monthTitle, parseKey, todayKey, WEEKDAY_LABELS } from "./lib/dates";
import { upcomingAnniversaries } from "./lib/anniversaries";
import { notesByDate, plansByDate, useData } from "./lib/storage";
import { SyncEngine, getSyncConfig, type SyncStatus } from "./lib/syncEngine";
import MonthGrid from "./components/MonthGrid";
import DayPanel from "./components/DayPanel";
import AnniversaryStrip from "./components/AnniversaryStrip";
import SyncPanel from "./components/SyncPanel";
import LoginScreen from "./components/LoginScreen";
import RemindersPanel from "./components/RemindersPanel";
import BirthdaysPanel from "./components/BirthdaysPanel";
import { useBirthdayReminders } from "./lib/birthdayScheduler";
import { requestReminderPermission, useReminderScheduler } from "./lib/reminderScheduler";
import { useDailyBriefing } from "./lib/briefing";
import { nextHoliday } from "./lib/holidays";
import { coerceData } from "./lib/validate";
import { apiAccounts, apiSetNickname } from "./lib/api";
import { DEFAULT_SYNC_SERVER } from "./lib/config";

/** 组合月历、每日计划、日记和账号同步等主界面。 */
export default function App() {
  const today = todayKey();
  const [view, setView] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [selected, setSelected] = useState(today);
  const [requestedDiary, setRequestedDiary] = useState<{ date: string; nonce: number }>();
  const directionRef = useRef(0);
  const reduced = useReducedMotion();

  const {
    data,
    replaceData,
    saveTimeline,
    addPlan,
    addAiPlans,
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
  } = useData();

  // 桌面端的同步走主进程（阶段 2），网页版在这里直接挂同步引擎
  const isDesktop = typeof window !== "undefined" && !!window.desktopAPI;
  const [syncOpen, setSyncOpen] = useState(false);
  const [remindersOpen, setRemindersOpen] = useState(false);
  const [birthdaysOpen, setBirthdaysOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("calendar.theme");
    if (saved === "dark" || saved === "light") return saved;
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  });
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    state: "off",
    lastSyncAt: null,
    message: null,
  });
  const [syncConfigured, setSyncConfigured] = useState(false);
  // 登录账号名（绑定分享时用于过滤自己）
  const [syncUser, setSyncUser] = useState<string | null>(() => getSyncConfig()?.username ?? null);
  // 账号名 → 昵称（分享标签显示用）
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  /** 拉取当前账号及可分享账号，更新昵称显示与登录状态。 */
  const refreshAccounts = useCallback(() => {
    const cfg = getSyncConfig();
    if (!cfg) return;
    void apiAccounts(cfg.server, cfg.token)
      .then(({ users, self }) => {
        const map: Record<string, string> = {};
        for (const u of users) if (u.nickname) map[u.username] = u.nickname;
        setNicknames(map);
        if (self?.username) setSyncUser(self.username);
      })
      .catch(() => {});
  }, []);
  // 登录态恢复完成前不渲染（避免已登录用户闪一下登录页）
  const [authReady, setAuthReady] = useState(isDesktop);
  const [accountReady, setAccountReady] = useState(false);
  // 桌面端「暂不登录，仅本机使用」：记住选择，⇅ 面板随时可再连接
  const [localMode, setLocalMode] = useState(
    () => localStorage.getItem("calendar.sync.skipped") === "1",
  );
  const dataRef = useRef(data);
  dataRef.current = data;

  // 桌面端也跑同一套同步引擎（主窗口；快速添加窗口渲染 QuickAdd，不经过这里）
  const engineRef = useRef<SyncEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new SyncEngine({
      /** 取得当前账号最新的本地数据快照。 */
      getLocal: () => dataRef.current,
      /** 将同步得到的数据快照应用到本地。 */
      apply: (next) => {
        dataRef.current = next;
        return replaceData(next);
      },
      onStatus: setSyncStatus,
    });
  }

  useEffect(() => {
    if (!engineRef.current) return;
    const restored = engineRef.current.restore();
    setSyncConfigured(restored);
    setAuthReady(true);
    if (restored) {
      // 先切到账号数据库并同步更新数据引用，再触发首次同步（顺序不能反，否则无主库会串进账号）
      const saved = getSyncConfig();
      const ready = saved?.username
        ? switchAccount(saved.username).then((d) => {
            if (d) dataRef.current = d;
          })
        : Promise.resolve();
      void ready.then(() => {
        setAccountReady(true);
        refreshAccounts();
        engineRef.current?.restoreSyncOnce();
      });
    } else {
      setAccountReady(true);
    }
    return () => engineRef.current?.stop();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // 双保险：个别内嵌浏览器环境下 html 层变量继承异常，body 同挂一份
    document.body.dataset.theme = theme;
    localStorage.setItem("calendar.theme", theme);
  }, [theme]);

  // 键盘快捷键：←→ 翻月、T 回今天、Esc 关闭弹层（输入框内不触发）
  useEffect(() => {
    /** 处理主界面的键盘快捷操作。 */
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))
        return;
      if (e.key === "ArrowLeft") go(-1);
      if (e.key === "ArrowRight") go(1);
      if (e.key === "t" || e.key === "T") backToToday();
      if (e.key === "Escape") {
        setSyncOpen(false);
        setRemindersOpen(false);
        setBirthdaysOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const byDate = useMemo(() => plansByDate(data.plans), [data.plans]);
  const dayNotes = useMemo(() => notesByDate(data.notes), [data.notes]);
  const aliveHabits = useMemo(() => data.habits.filter((h) => h.deletedAt === null), [data.habits]);
  const aliveReminders = useMemo(
    () => data.reminders.filter((r) => r.deletedAt === null),
    [data.reminders],
  );
  const homeCity = data.homeCity?.city ?? null;
  const watchCity = data.watchCity?.city ?? null;

  /** 连接账号：先切到该账号的本地数据库（首次登录会认领无主数据），再启用同步 */
  const connectAccount = useCallback(
    (server: string, token: string, username: string) => {
      void (async () => {
        setAccountReady(false);
        const d = await switchAccount(username);
        if (d) dataRef.current = d;
        localStorage.removeItem("calendar.sync.skipped");
        setLocalMode(false);
        engineRef.current!.enable(server, token, username);
        setSyncUser(username);
        setSyncConfigured(true);
        setAccountReady(true);
        refreshAccounts();
      })();
    },
    [switchAccount, refreshAccounts],
  );

  /** 显示短暂提示，并在超时后自动清除。 */
  const showToast = useCallback((text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(null), 6000);
  }, []);

  // 网页版页内提醒；桌面端由主进程触发
  useReminderScheduler(aliveReminders, !isDesktop, showToast);
  useBirthdayReminders(
    authReady && accountReady && (syncConfigured || localMode),
    syncConfigured ? (getSyncConfig()?.username ?? syncUser) : null,
    () => dataRef.current.anniversaries,
    async () => (!syncConfigured ? undefined : engineRef.current!.syncOnce()),
    showToast,
  );
  useDailyBriefing(
    authReady && accountReady && (syncConfigured || localMode),
    syncConfigured ? (getSyncConfig()?.username ?? syncUser) : null,
    () => ({ plans: dataRef.current.plans, home: dataRef.current.homeCity?.city ?? null }),
    async () =>
      !syncConfigured ? "local" : (await engineRef.current!.syncOnce()) ? "fresh" : "failed",
    showToast,
  );

  const aliveAnniversaries = useMemo(
    () => data.anniversaries.filter((a) => a.deletedAt === null),
    [data.anniversaries],
  );

  const monthStats = useMemo(() => {
    const prefix = `${view.year}-${String(view.month + 1).padStart(2, "0")}`;
    const inMonth = data.plans.filter((p) => p.date.startsWith(prefix) && p.deletedAt === null);
    const done = inMonth.filter((p) => p.done).length;
    const checkIns = aliveHabits.reduce(
      (n, h) => n + h.checkIns.filter((d) => d.startsWith(prefix)).length,
      0,
    );
    return {
      total: inMonth.length,
      done,
      checkIns,
      rate: inMonth.length ? Math.round((done / inMonth.length) * 100) : 0,
    };
  }, [data, view, aliveHabits]);

  const upcoming = useMemo(() => {
    // 纪念日和家人生日共用一个位置，法定假期倒计时独立保留。
    const items = upcomingAnniversaries(aliveAnniversaries, today, 1);
    const holiday = nextHoliday(today);
    if (holiday) {
      items.push({
        id: "holiday-builtin",
        name: holiday.ongoing ? `${holiday.name}（假期中）` : `距${holiday.name}`,
        kind: "yearly",
        date: holiday.date,
        days: holiday.days,
        builtin: true,
      });
    }
    return items.sort((a, b) => a.days - b.days);
  }, [aliveAnniversaries, today]);

  /** 按给定月份偏移切换月历，并记录翻页方向。 */
  const go = (delta: number) => {
    directionRef.current = delta;
    setView((v) => addMonths(v.year, v.month, delta));
  };

  /** 将月历视图和选中日期一起恢复到今天。 */
  const backToToday = () => {
    const now = new Date();
    const target = now.getFullYear() * 12 + now.getMonth();
    const current = view.year * 12 + view.month;
    directionRef.current = target >= current ? 1 : -1;
    setView({ year: now.getFullYear(), month: now.getMonth() });
    setSelected(today);
  };

  /** 切换到目标日期所在月份，并选中该日期。 */
  const jumpToDate = (dateKey: string) => {
    const d = parseKey(dateKey);
    const target = d.getFullYear() * 12 + d.getMonth();
    const current = view.year * 12 + view.month;
    directionRef.current = target >= current ? 1 : -1;
    setView({ year: d.getFullYear(), month: d.getMonth() });
    setSelected(dateKey);
  };

  const ymKey = `${view.year}-${view.month}`;
  const slideFrom = directionRef.current >= 0 ? 56 : -56;

  // 账号登录门：三端统一——登录即接入账号数据（网页端必须登录；桌面端可暂skip离线使用）
  if (!authReady) return null;
  if (!syncConfigured && !(isDesktop && localMode)) {
    return (
      <LoginScreen
        defaultServer={
          isDesktop || import.meta.env?.VITE_CLOUD_TRIAL === "true"
            ? DEFAULT_SYNC_SERVER
            : window.location.origin
        }
        allowSkip={isDesktop}
        onSkip={() => {
          localStorage.setItem("calendar.sync.skipped", "1");
          setLocalMode(true);
        }}
        onConnect={connectAccount}
      />
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-eyebrow">MY LITTLE DAYS · 我的小日子</span>
          <h1>
            日历表
            <span className="brand-flower" aria-hidden="true">
              ✿
            </span>
          </h1>
          <p className="tagline">计划要做的事，收下做成的事</p>
        </div>
        <nav className="month-nav">
          <button className="icon-btn" onClick={() => go(-1)} aria-label="上一个月">
            ‹
          </button>
          <motion.h2
            className="month-title"
            key={ymKey}
            initial={reduced ? false : { opacity: 0, y: directionRef.current >= 0 ? 10 : -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 26 }}
          >
            {monthTitle(view.year, view.month)}
          </motion.h2>
          <button className="icon-btn" onClick={() => go(1)} aria-label="下一个月">
            ›
          </button>
          <button className="today-btn" onClick={backToToday}>
            今天
          </button>
          <div className="sync-entry">
            <button
              className="icon-btn"
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              aria-label="切换深色模式"
              title={theme === "dark" ? "切到浅色" : "切到深色"}
            >
              {theme === "dark" ? "☀️" : "🌙"}
            </button>
          </div>
          <div className="sync-entry">
            <button
              className="icon-btn"
              onClick={() => setRemindersOpen((v) => !v)}
              aria-label="定时提醒"
              title="定时提醒"
            >
              ⏰
            </button>
            {remindersOpen && (
              <RemindersPanel
                reminders={data.reminders}
                today={today}
                onAdd={(input) => {
                  addReminder(input);
                  if (!isDesktop) void requestReminderPermission();
                }}
                onToggle={setReminderEnabled}
                onRemove={removeReminder}
                onClose={() => setRemindersOpen(false)}
              />
            )}
          </div>
          <div className="sync-entry">
            <button
              className="icon-btn"
              onClick={() => setBirthdaysOpen(true)}
              aria-label="家人生日"
              title="家人生日"
            >
              🎂
            </button>
            {birthdaysOpen && (
              <BirthdaysPanel
                anniversaries={data.anniversaries}
                today={today}
                onAdd={(name, birthday) => {
                  addAnniversary(name, "yearly", "2000-01-01", birthday);
                  if (!isDesktop) void requestReminderPermission();
                }}
                onRemove={removeAnniversary}
                onClose={() => setBirthdaysOpen(false)}
              />
            )}
          </div>
          <div className="sync-entry">
            <button
              className={`icon-btn sync-btn ${syncStatus.state}`}
              onClick={() => setSyncOpen((v) => !v)}
              aria-label="多端同步"
              title={
                syncStatus.state === "error"
                  ? `同步出错：${syncStatus.message}`
                  : !syncConfigured
                    ? "登录账号，开启三端数据互通"
                    : syncStatus.lastSyncAt
                      ? `多端同步 · 最近 ${new Date(syncStatus.lastSyncAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
                      : "多端同步"
              }
            >
              ⇅
            </button>
            {syncOpen && engineRef.current && (
              <SyncPanel
                status={syncStatus}
                configured={syncConfigured}
                onConnect={(server, token, username) => {
                  connectAccount(server, token, username);
                  setSyncOpen(false);
                }}
                selfUser={syncUser}
                selfNickname={syncUser ? (nicknames[syncUser] ?? null) : null}
                onSetNickname={async (nickname) => {
                  const cfg = getSyncConfig();
                  if (!cfg) return;
                  await apiSetNickname(cfg.server, cfg.token, nickname);
                  refreshAccounts();
                }}
                onDisconnect={() => {
                  setAccountReady(false);
                  engineRef.current!.disable();
                  setSyncUser(null);
                  // 退回到无主本地库（各账号库保留在盘上，随时可切回）
                  void switchAccount(null).then((d) => {
                    if (d) dataRef.current = d;
                    setAccountReady(true);
                  });
                  localStorage.removeItem("calendar.sync.skipped");
                  setLocalMode(false);
                  setSyncConfigured(false);
                }}
                onSyncNow={() => engineRef.current!.forceSyncOnce()}
                onClose={() => setSyncOpen(false)}
              />
            )}
          </div>
        </nav>
      </header>

      <section className="calendar-welcome" aria-label="日历寄语">
        <div>
          <span className="welcome-label">把日子，过成喜欢的样子</span>
          <h2>今天也有小小的期待。</h2>
          <p>安排一点计划，收集一点快乐。每个平凡日子都值得记住。</p>
        </div>
        <div className="welcome-art">
          <span className="buddy-note">慢慢来，也很好 ♡</span>
          <CalendarBuddy />
        </div>
      </section>

      <AnniversaryStrip
        upcoming={upcoming}
        hasAny={aliveAnniversaries.length > 0}
        onJump={jumpToDate}
        onAdd={addAnniversary}
        onRemove={removeAnniversary}
        home={homeCity}
        watch={watchCity}
        onSetHome={setHomeCity}
        onSetWatch={setWatchCity}
      />

      <div className="summary">
        <span>
          本月计划 <b>{monthStats.total}</b>
        </span>
        <span className="dot">·</span>
        <span>
          完成 <b>{monthStats.done}</b>
        </span>
        <span className="dot">·</span>
        <span>
          打卡 <b>{monthStats.checkIns}</b> 次
        </span>
        <span className="dot">·</span>
        <span>
          完成率 <b>{monthStats.rate}%</b>
        </span>
        <div className="summary-bar" aria-hidden="true">
          <motion.div
            className="summary-fill"
            animate={{ width: `${monthStats.rate}%` }}
            transition={{ type: "spring", stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      <main className="layout">
        <section className="grid-col" aria-label="月历">
          <div className="calendar-caption">
            <span>这一月的小日子</span>
            <span className="calendar-legend">
              <i />
              工作 <i />
              生活
            </span>
          </div>
          <div className="weekdays">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w} className="weekday">
                {w}
              </span>
            ))}
          </div>
          <motion.div
            className="grid-wrap"
            key={ymKey}
            initial={reduced ? false : { x: slideFrom, opacity: 0.5 }}
            animate={{ x: 0, opacity: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
          >
            <MonthGrid
              year={view.year}
              month={view.month}
              timelineCount={(key) =>
                data.timelines.filter((t) => onDay(t, data.plans, key)).length
              }
              plansByDate={byDate}
              notesByDate={dayNotes}
              anniversaries={aliveAnniversaries}
              reminders={aliveReminders}
              today={today}
              selected={selected}
              onSelect={setSelected}
            />
          </motion.div>
        </section>
        <aside className="panel-col">
          <DiaryPanel
            key={JSON.stringify([syncUser, syncConfigured])}
            date={selected}
            requestedDate={requestedDiary}
          />
          <AiPanel
            key={JSON.stringify([syncUser, syncConfigured])}
            date={selected}
            savePlans={addAiPlans}
            openDiary={(date) => setRequestedDiary({ date, nonce: Date.now() })}
          />
          <TimelinePanel data={data} date={selected} save={saveTimeline} toggle={togglePlan} />
          <DayPanel
            dateKey={selected}
            today={today}
            plans={byDate.get(selected) ?? []}
            notes={dayNotes.get(selected) ?? []}
            habits={aliveHabits}
            canShare={syncConfigured}
            selfUser={syncUser}
            displayName={(u) => nicknames[u] ?? u}
            mutations={{
              setPlanShare,
              setNoteShare,
              addPlan,
              togglePlan,
              removePlan,
              addNote,
              removeNote,
              addHabit,
              toggleHabitCheckIn,
              removeHabit,
            }}
          />
        </aside>
      </main>

      <footer className="panel-footer">
        <button
          className="link-btn"
          onClick={() => {
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `日历表备份-${today}.json`;
            a.click();
            URL.revokeObjectURL(url);
          }}
        >
          导出数据
        </button>
        <span className="dot">·</span>
        <label className="link-btn import-label">
          导入备份
          <input
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const parsed = JSON.parse(await file.text());
                const cleaned = coerceData(parsed.data ?? parsed);
                if (
                  !window.confirm(
                    `导入将覆盖当前全部数据（计划 ${cleaned.plans.length} 条、记录 ${cleaned.notes.length} 条、习惯 ${cleaned.habits.length} 个、纪念日 ${cleaned.anniversaries.length} 个、提醒 ${cleaned.reminders.length} 条）。继续？`,
                  )
                ) {
                  return;
                }
                replaceAll(cleaned);
                showToast("导入完成");
              } catch {
                showToast("文件解析失败，已取消导入");
              }
            }}
          />
        </label>
      </footer>

      {toast && (
        <div className="reminder-toast" role="status">
          <span className="reminder-toast-icon">⏰</span>
          {toast}
        </div>
      )}
    </div>
  );
}
