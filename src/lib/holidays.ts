import holidayData from "../../resources/holidays.json";
import { parseKey, weekdayOf } from "./dates";
import { daysBetween } from "./anniversaries";

export interface HolidayInfo {
  kind: "holiday" | "adjusted";
  name: string;
}

/** 该日的放假/调休信息；普通日返回 null */
export function holidayInfoOf(dateStr: string): HolidayInfo | null {
  const adjusted = (holidayData.adjusted as Record<string, string>)[dateStr];
  if (adjusted) return { kind: "adjusted", name: adjusted };
  for (const r of holidayData.ranges) {
    if (dateStr >= r.start && dateStr <= r.end) {
      return { kind: "holiday", name: r.name };
    }
  }
  return null;
}

/** 中国实际工作日：调休上班日算工作日，法定假不算，其余按周一至周五 */
export function isChineseWorkday(dateStr: string): boolean {
  const info = holidayInfoOf(dateStr);
  if (info) return info.kind === "adjusted";
  return weekdayOf(parseKey(dateStr)) <= 5;
}

export interface NextHoliday {
  name: string;
  /** 假期首日 */
  date: string;
  days: number;
  /** 今天就在假期中 */
  ongoing: boolean;
}

/** 下一个法定假期（含进行中的）；数据未覆盖的年份返回 null */
export function nextHoliday(todayStr: string): NextHoliday | null {
  let best: NextHoliday | null = null;
  for (const r of holidayData.ranges) {
    if (todayStr > r.end) continue;
    const ongoing = todayStr >= r.start;
    const days = daysBetween(todayStr, ongoing ? todayStr : r.start);
    if (!best || days < best.days) {
      best = { name: r.name, date: r.start, days, ongoing };
    }
  }
  return best;
}
