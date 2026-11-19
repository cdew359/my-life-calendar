package cn.imlaomi.cloud.diary.entity;

/** 指定账号下的一条日记数据库记录，账号由 DAO 查询条件限定。 */
public record DiaryEntryEntity(
    String date,
    String title,
    String content,
    int revision,
    long createdAt,
    long updatedAt,
    boolean deleted
) {}
