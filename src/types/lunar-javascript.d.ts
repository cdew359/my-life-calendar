// lunar-javascript 未自带类型声明，这里只声明项目用到的 API 面
declare module "lunar-javascript" {
  export interface Lunar {
    /** 返回农历年份。 */
    getYear(): number;
    /** 返回对应的公历日期。 */
    getSolar(): SolarDate;
    /** 农历月份数，闰月为负（闰六月 = -6） */
    getMonth(): number;
    /** 返回农历月份的中文名称。 */
    getMonthInChinese(): string;
    /** 返回农历日期的中文名称。 */
    getDayInChinese(): string;
    /** 返回农历年份对应的干支文本。 */
    getYearInGanZhi(): string;
    /** 恰好落在节气当天返回节气名，否则返回空串 */
    getJieQi(): string;
  }

  export interface SolarDate {
    /** 返回 YYYY-MM-DD 公历日期。 */
    toYmd(): string;
    /** 将当前公历日期转换为农历信息。 */
    getLunar(): Lunar;
  }

  export const Solar: {
    /** 使用 JavaScript 日期对象创建公历日期实例。 */
    fromDate(date: Date): SolarDate;
    /** 使用公历年月日创建日期实例。 */
    fromYmd(year: number, month: number, day: number): SolarDate;
  };
  export const Lunar: {
    /** 以农历年月日创建日期，负月份表示闰月。 */
    fromYmd(year: number, month: number, day: number): Lunar;
  };
  export const LunarMonth: {
    /** 返回指定农历月份，年份没有该闰月时返回空值。 */
    fromYm(
      year: number,
      month: number,
    ): {
      /** 返回农历月份。 */ getMonth(): number;
      /** 返回当月天数。 */ getDayCount(): number;
    } | null;
  };
}
