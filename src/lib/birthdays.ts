import { Lunar, LunarMonth, Solar } from "lunar-javascript";
import { dateKey, parseKey } from "./dates";
import type { Anniversary, Birthday } from "./types";

/** 将生日换算为指定历法年份的公历日期，大小月和缺少闰月时按界面约定回退。 */
export function birthdayInYear(birthday: Birthday, year: number): string {
  const { month, day } = birthday;
  if (birthday.calendar === "solar") {
    return dateKey(new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate())));
  }
  const requested = birthday.leapMonth ? -month : month;
  const lunarMonth = LunarMonth.fromYm(year, requested) ?? LunarMonth.fromYm(year, month)!;
  return Lunar.fromYmd(year, lunarMonth.getMonth(), Math.min(day, lunarMonth.getDayCount()))
    .getSolar()
    .toYmd();
}

/** 从今天起找下一次生日，农历年从当前农历年开始，避免漏掉公历年初的腊月生日。 */
export function nextBirthday(birthday: Birthday, today: string): string {
  const date = parseKey(today);
  const year =
    birthday.calendar === "lunar" ? Solar.fromDate(date).getLunar().getYear() : date.getFullYear();
  const current = birthdayInYear(birthday, year);
  return current >= today ? current : birthdayInYear(birthday, year + 1);
}

/** 把保存的月日规则显示为中文，区分公历、农历和闰月。 */
export function birthdayLabel(birthday: Birthday): string {
  return `${birthday.calendar === "lunar" ? "农历" : "公历"}${birthday.leapMonth ? "闰" : ""}${birthday.month}月${birthday.day}日`;
}

export interface BirthdayNotice {
  key: string;
  body: string;
}

/** 逐条发送并记录成功的提醒；失败不去重，切换账号后停止发送及写入旧会话状态。 */
export async function deliverBirthdayNotices(
  notices: BirthdayNotice[],
  fired: Record<string, string>,
  today: string,
  send: (notice: BirthdayNotice) => Promise<boolean>,
  persist: () => void,
  active: () => boolean,
): Promise<void> {
  for (const notice of notices) {
    if (!active()) return;
    if (fired[notice.key] === today) continue;
    let delivered = false;
    try {
      delivered = await send(notice);
    } catch {
      /* 下一次检查重试，不影响其他家人的提醒。 */
    }
    if (!active()) return;
    if (!delivered) continue;
    fired[notice.key] = today;
    try {
      persist();
    } catch {
      /* 存储失败仅影响重启去重。 */
    }
  }
}

/** 生成当前本地时间应发送的提醒；上午仅在 09:00 至 12:00 之间补发，晚间从 20:00 起。 */
export function dueBirthdays(anniversaries: Anniversary[], now: Date): BirthdayNotice[] {
  const hour = now.getHours();
  if (!(hour >= 9 && hour < 12) && hour < 20) return [];
  const today = dateKey(now);
  const target =
    hour >= 20 ? dateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) : today;
  const stage = hour >= 20 ? "eve" : "morning";
  return anniversaries
    .filter(
      (a) => a.deletedAt === null && a.birthday && nextBirthday(a.birthday, target) === target,
    )
    .map((a) => ({
      key: `${a.id}:${target}:${stage}`,
      body: `${stage === "eve" ? "明天" : "今天"}是${a.name}的生日 🎂，${birthdayLabel(a.birthday!)}。${stage === "eve" ? "记得准备祝福或礼物。" : "送上一句生日快乐吧！"}`,
    }));
}
