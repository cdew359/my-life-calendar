import type { Birthday } from "./types";

/** 清洗跨网页、客户端和服务端传递的生日规则，拒绝无效月日。 */
export function coerceBirthday(value: unknown): Birthday | undefined {
  if (!value || typeof value !== "object") return undefined;
  const b = value as Record<string, unknown>;
  if (b.calendar !== "solar" && b.calendar !== "lunar") return undefined;
  if (!Number.isInteger(b.month) || !Number.isInteger(b.day)) return undefined;
  const month = b.month as number,
    day = b.day as number;
  if (month < 1 || month > 12 || day < 1) return undefined;
  const max = b.calendar === "lunar" ? 30 : new Date(2000, month, 0).getDate();
  if (day > max) return undefined;
  return {
    calendar: b.calendar,
    month,
    day,
    leapMonth: b.calendar === "lunar" && b.leapMonth === true,
  };
}
