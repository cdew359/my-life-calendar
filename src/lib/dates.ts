export type DayCell = {
  /** 本地日期键 "YYYY-MM-DD" */
  key: string;
  day: number;
  inMonth: boolean;
};

/** 按本地时区生成 YYYY-MM-DD 日期键，避免 UTC 转换导致日期偏移。 */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 返回本地时区今天的日期键。 */
export function todayKey(): string {
  return dateKey(new Date());
}

/** 明天的日期键 */
export function tomorrowKey(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return dateKey(d);
}

/** 将 YYYY-MM-DD 日期键解析为本地零点的日期对象。 */
export function parseKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** 周一为 0 …… 周日为 6 */
export function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** 固定 42 格（6 行），从本月初见前的周一算起，跨月日期标记 inMonth=false */
export function buildMonthGrid(year: number, month: number): DayCell[] {
  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - mondayIndex(first));
  const cells: DayCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    cells.push({ key: dateKey(d), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

export const WEEKDAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];

/** 周一=1 …… 周日=7 */
export function weekdayOf(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export const WEEKDAY_FULL = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 将年份和从零开始的月份转换为中文月历标题。 */
export function monthTitle(year: number, month: number): string {
  return `${year}年${month + 1}月`;
}

/** 按月份偏移计算新年月，自动处理跨年。 */
export function addMonths(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  const d = new Date(year, month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
}
