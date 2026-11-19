package cn.imlaomi.cloud.diary.dto;

import java.util.List;

/** ES 适配层输出的强类型命中结果，正文仍从当前账号的 MySQL 记录回查。 */
public record DiarySearchResult(long total, List<Hit> hits) {
    public record Hit(String date, int revision) {}
}
