export type Domain = "work" | "life";

/** 同步用元数据：updatedAt 驱动最后写入赢，deletedAt 做删除墓碑 */
export interface SyncMeta {
  updatedAt: number;
  deletedAt: number | null;
}

export interface Plan extends SyncMeta {
  id: string;
  /** "YYYY-MM-DD"，本地日期 */
  date: string;
  text: string;
  done: boolean;
  doneAt: number | null;
  createdAt: number;
  domain: Domain;
  /** 绑定的账号（对方同步时会收到这条的副本） */
  shareWith?: string[];
  /** 收到的分享来源（对方账号名；仅出现在被分享方的副本上） */
  sharedBy?: string;
}

/** 每日记录：当天发生的事，无需提前计划 */
export interface DayNote extends SyncMeta {
  id: string;
  date: string;
  text: string;
  createdAt: number;
  domain: Domain;
  /** 绑定的账号（对方同步时会收到这条的副本） */
  shareWith?: string[];
  /** 收到的分享来源（对方账号名；仅出现在被分享方的副本上） */
  sharedBy?: string;
}

/** 习惯打卡：checkIns 为已打卡的日期键（升序）；同步时打卡按并集合并 */
export interface Habit extends SyncMeta {
  id: string;
  text: string;
  domain: Domain;
  createdAt: number;
  archivedAt: number | null;
  checkIns: string[];
}

/** 纪念日：yearly 按月日每年重复；once 单次倒计时 */
export interface Anniversary extends SyncMeta {
  id: string;
  name: string;
  kind: "yearly" | "once";
  date: string;
  createdAt: number;
  /** 家人生日规则；缺失时仍按原纪念日处理。 */
  birthday?: Birthday;
}

export interface Birthday {
  calendar: "solar" | "lunar";
  month: number;
  day: number;
  leapMonth: boolean;
}

/** 定时提醒：weekly 按周几集合（工作日/周末是预设）；periodic 每 N 天 */
export interface Reminder extends SyncMeta {
  id: string;
  text: string;
  /** "HH:mm" 本地时间 */
  time: string;
  mode: "weekly" | "periodic";
  /** mode=weekly：周几集合，周一=1 周日=7，升序去重 */
  weekdays: number[];
  /** mode=periodic：每 N 天 */
  periodDays: number;
  /** mode=periodic：起算日 "YYYY-MM-DD" */
  anchorDate: string;
  enabled: boolean;
  createdAt: number;
}

/** 城市：常驻地区（Open-Meteo 坐标） */
export interface CityRecord {
  name: string;
  lat: number;
  lon: number;
}

/** 常驻地区（单例，随数据同步）：天气与简报的默认城市 */
export interface HomeCity {
  city: CityRecord;
  updatedAt: number;
}

export interface AppData {
  version: 2;
  timelines: Timeline[];
  plans: Plan[];
  notes: DayNote[];
  habits: Habit[];
  anniversaries: Anniversary[];
  reminders: Reminder[];
  homeCity: HomeCity | null;
  /** 额外关注的天气城市（最多一个，右上角与常驻并排显示） */
  watchCity: HomeCity | null;
}

export interface Timeline extends SyncMeta {
  id: string;
  name: string;
  date: string;
  startTime: string;
  /** Fixed deadline; missing only in legacy forward schedules. date is the deadline date. */
  endTime?: string;
  /** Steps are private to the timeline; only the published goal is a calendar plan. */
  stepsMode?: boolean;
  goalPlanId?: string;
  domain?: Domain;
  createdAt: number;
  items: { id: string; planId: string; durationMinutes: number; step?: Plan }[];
}
