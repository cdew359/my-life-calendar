import type { Reminder } from "./types";
import { dateKey, parseKey, weekdayOf } from "./dates";
import { daysBetween } from "./anniversaries";
import { isChineseWorkday } from "./holidays";

export { weekdayOf };

const WEEKDAY_CN = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];

/** 比较两组重复日期是否包含相同元素，忽略排列顺序。 */
function sameSet(a: number[], b: number[]) {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** 该日期是否适用（periodic 需不早于起算日） */
export function reminderAppliesOn(r: Reminder, dateStr: string): boolean {
  if (r.mode === "weekly") {
    // 工作日预设（周一至周五）按中国实际工作日：调休上班日照常提醒、法定假不提醒
    const isWorkdayPreset =
      r.weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => r.weekdays.includes(d));
    if (isWorkdayPreset) return isChineseWorkday(dateStr);
    return r.weekdays.includes(weekdayOf(parseKey(dateStr)));
  }
  if (dateStr < r.anchorDate) return false;
  return daysBetween(r.anchorDate, dateStr) % Math.max(1, r.periodDays) === 0;
}

/** "HH:mm" → 当天分钟数 */
export function timeMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/** 规则摘要：每天 / 工作日 / 周末 / 周一、周三… / 每 N 天 */
export function describeRule(r: Reminder): string {
  if (r.mode === "weekly") {
    const days = [...r.weekdays].sort((a, b) => a - b);
    if (sameSet(days, [1, 2, 3, 4, 5, 6, 7])) return "每天";
    if (sameSet(days, [1, 2, 3, 4, 5])) return "工作日";
    if (sameSet(days, [6, 7])) return "周末";
    return days.map((d) => WEEKDAY_CN[d]).join("、");
  }
  return `每 ${Math.max(1, r.periodDays)} 天`;
}

/** 从 fromKey（含）起第一个适用日；最多向前看 400 天 */
export function nextFireDate(r: Reminder, fromKey: string): string | null {
  const cursor = parseKey(fromKey);
  for (let i = 0; i < 400; i++) {
    const key = dateKey(cursor);
    if (reminderAppliesOn(r, key)) return key;
    cursor.setDate(cursor.getDate() + 1);
  }
  return null;
}
