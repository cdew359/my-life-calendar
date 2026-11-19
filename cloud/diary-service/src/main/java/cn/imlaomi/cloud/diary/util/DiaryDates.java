package cn.imlaomi.cloud.diary.util;

import cn.imlaomi.cloud.common.exception.ApiException;
import java.time.DateTimeException;
import java.time.LocalDate;

/** 日记日期格式校验工具。 */
public final class DiaryDates {

    /** 校验固定格式、真实日历日期和有效年份。 */
    public static boolean validDate(String date) {
        try {
            return (
                date.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") &&
                !date.startsWith("0000") &&
                LocalDate.parse(date).toString().equals(date)
            );
        } catch (DateTimeException failure) {
            return false;
        }
    }

    /** 对非法日期给出既有业务错误。 */
    public static void requireDate(String date) {
        if (!validDate(date)) throw new ApiException(400, "日期无效");
    }
}
