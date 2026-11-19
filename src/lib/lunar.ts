import { Solar } from "lunar-javascript";

export type LunarLabelKind = "jieqi" | "month" | "day";

export interface LunarLabel {
  text: string;
  kind: LunarLabelKind;
}

/**
 * 日历格子的农历小字。惯例优先级：节气 > 月名（初一显示）> 农历日。
 */
export function lunarLabel(date: Date): LunarLabel {
  const lunar = Solar.fromDate(date).getLunar();
  const jieqi = lunar.getJieQi();
  if (jieqi) return { text: jieqi, kind: "jieqi" };
  const day = lunar.getDayInChinese();
  if (day === "初一") {
    // 闰月时 getMonthInChinese() 已自带「闰」前缀（如「闰六」）
    return { text: `${lunar.getMonthInChinese()}月`, kind: "month" };
  }
  return { text: day, kind: "day" };
}

/** 日面板的完整农历信息，如「农历八月初六 · 丙午年」 */
export function lunarFull(date: Date): string {
  const lunar = Solar.fromDate(date).getLunar();
  return `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()} · ${lunar.getYearInGanZhi()}年`;
}
