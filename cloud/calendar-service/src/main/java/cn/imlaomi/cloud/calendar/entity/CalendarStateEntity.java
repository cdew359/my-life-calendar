package cn.imlaomi.cloud.calendar.entity;

/** 日历文档表记录，JSON 只在业务层边界解码。 */
public record CalendarStateEntity(String accountId, long version, String payload) {}
