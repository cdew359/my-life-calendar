package cn.imlaomi.cloud.calendar.dto;

/** 日历读取或上传后的响应，保持 version 与 data 两个顶层字段。 */
public record CalendarStateResponse(long version, CalendarData data) {}
