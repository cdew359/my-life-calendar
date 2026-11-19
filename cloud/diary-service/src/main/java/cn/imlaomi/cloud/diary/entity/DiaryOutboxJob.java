package cn.imlaomi.cloud.diary.entity;

/** 已在当前事务中锁定的日记索引待办，字段类型由 JDBC 行映射器确定。 */
public record DiaryOutboxJob(long id, String accountId, String date, int attempts) {}
