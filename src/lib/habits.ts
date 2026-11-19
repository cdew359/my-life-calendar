import { dateKey, parseKey } from "./dates";
import type { Habit } from "./types";

/**
 * 截至 upto（含）的连续打卡天数。
 * upto 当天未打不断签——从昨天起算，今天完成后再 +1。
 */
export function habitStreak(habit: Habit, upto: string): number {
  const set = new Set(habit.checkIns);
  const cursor = parseKey(upto);
  if (!set.has(dateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  let streak = 0;
  while (set.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 切换指定日期的打卡记录，并保持日期列表规范。 */
export function toggleCheckIn(habit: Habit, date: string): Habit {
  if (habit.checkIns.includes(date)) {
    return { ...habit, checkIns: habit.checkIns.filter((d) => d !== date) };
  }
  return { ...habit, checkIns: [...habit.checkIns, date].sort() };
}
