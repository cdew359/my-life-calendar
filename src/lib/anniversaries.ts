import { dateKey, parseKey } from "./dates";
import type { Anniversary } from "./types";
import { nextBirthday } from "./birthdays";

/** 某年的重复日；2/29 落在平年由 Date 自动顺延到 3/1 */
function occurrenceInYear(ann: Anniversary, year: number): string {
  const base = parseKey(ann.date);
  return dateKey(new Date(year, base.getMonth(), base.getDate()));
}

/** 下一次到来的日期键；once 且已过返回 null */
export function nextOccurrence(ann: Anniversary, todayKey: string): string | null {
  if (ann.birthday) return nextBirthday(ann.birthday, todayKey);
  if (ann.kind === "once") {
    return ann.date >= todayKey ? ann.date : null;
  }
  const t = parseKey(todayKey);
  const thisYear = occurrenceInYear(ann, t.getFullYear());
  if (thisYear >= todayKey) return thisYear;
  return occurrenceInYear(ann, t.getFullYear() + 1);
}

/** 按本地日历日期计算相隔天数，避免夏令时造成小时差误判。 */
export function daysBetween(fromKey: string, toKey: string): number {
  const a = parseKey(fromKey);
  a.setHours(12, 0, 0, 0);
  const b = parseKey(toKey);
  b.setHours(12, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

export interface UpcomingAnniversary {
  id: string;
  name: string;
  kind: Anniversary["kind"];
  date: string;
  days: number;
  /** 内置条目（如假期倒计时）：不可删除 */
  builtin?: boolean;
}

/** 接下来的纪念日（含今天），按剩余天数升序 */
export function upcomingAnniversaries(
  anniversaries: Anniversary[],
  todayKey: string,
  limit = 4,
): UpcomingAnniversary[] {
  return anniversaries
    .map((ann) => {
      const date = nextOccurrence(ann, todayKey);
      return date
        ? {
            id: ann.id,
            name: ann.birthday ? `${ann.name}生日` : ann.name,
            kind: ann.kind,
            date,
            days: daysBetween(todayKey, date),
          }
        : null;
    })
    .filter((item): item is UpcomingAnniversary => item !== null)
    .sort((a, b) => a.days - b.days)
    .slice(0, limit);
}

/** 该日期是否有纪念日命中（yearly 按月日匹配，once 全等） */
export function anniversaryOnDate(anniversaries: Anniversary[], dateStr: string): string | null {
  const parts = dateStr.split("-").map(Number);
  const m = parts[1];
  const d = parts[2];
  for (const ann of anniversaries) {
    if (ann.birthday) {
      if (nextBirthday(ann.birthday, dateStr) === dateStr) return `${ann.name}生日`;
      continue;
    }
    if (ann.kind === "once") {
      if (ann.date === dateStr) return ann.name;
    } else {
      const ap = ann.date.split("-").map(Number);
      if (ap[1] === m && ap[2] === d) return ann.name;
    }
  }
  return null;
}
